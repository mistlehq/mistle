import type {
  DesignerEvalAssertion,
  DesignerEvalCheckResult,
  DesignerEvalDashboardControlAction,
  DesignerEvalProductState,
  DesignerEvalResult,
} from "../types.ts";

export function evaluateDesignerEvalRun(input: {
  caseId: string;
  assertions: readonly DesignerEvalAssertion[];
  dashboardControlActions: readonly DesignerEvalDashboardControlAction[];
  productStateAfter: DesignerEvalProductState;
}): DesignerEvalResult {
  const checks = input.assertions.map((assertion) =>
    evaluateAssertion({
      assertion,
      dashboardControlActions: input.dashboardControlActions,
      productStateAfter: input.productStateAfter,
    }),
  );

  return {
    caseId: input.caseId,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

export function renderEvaluationMarkdown(result: DesignerEvalResult): string {
  const status = result.passed ? "PASS" : "FAIL";
  const checkLines = result.checks.map((check) => {
    const marker = check.passed ? "[x]" : "[ ]";
    return `- ${marker} ${check.label}: ${check.detail}`;
  });

  return [`# Designer eval: ${result.caseId}`, "", `Status: ${status}`, "", ...checkLines, ""].join(
    "\n",
  );
}

function evaluateAssertion(input: {
  assertion: DesignerEvalAssertion;
  dashboardControlActions: readonly DesignerEvalDashboardControlAction[];
  productStateAfter: DesignerEvalProductState;
}): DesignerEvalCheckResult {
  switch (input.assertion.kind) {
    case "blueprint-before-product-mutation":
      return evaluateBlueprintBeforeProductMutation(input.dashboardControlActions);
    case "saved-selected-provider-resources":
      return evaluateSavedSelectedProviderResources({
        assertion: input.assertion,
        productStateAfter: input.productStateAfter,
      });
    case "user-input-requested":
      return evaluateUserInputRequested({
        inputId: input.assertion.inputId,
        dashboardControlActions: input.dashboardControlActions,
      });
  }
}

function evaluateBlueprintBeforeProductMutation(
  actions: readonly DesignerEvalDashboardControlAction[],
): DesignerEvalCheckResult {
  const firstBlueprint = actions.find(
    (action) => action.kind === "show_designer_canvas_tab" && action.tabKind === "blueprint",
  );
  const firstProductMutation = actions.find(
    (action) => action.kind === "request_user_input" && responseHasSideEffect(action.response),
  );

  if (firstBlueprint === undefined) {
    return {
      passed: false,
      label: "Blueprint before product mutation",
      detail: "Designer did not show a blueprint.",
    };
  }

  if (
    firstProductMutation === undefined ||
    firstBlueprint.sequence < firstProductMutation.sequence
  ) {
    return {
      passed: true,
      label: "Blueprint before product mutation",
      detail:
        firstProductMutation === undefined
          ? "Designer showed a blueprint and no product mutation was observed."
          : "Designer showed a blueprint before the first dashboard-mediated product mutation.",
    };
  }

  return {
    passed: false,
    label: "Blueprint before product mutation",
    detail: "Designer attempted a dashboard-mediated product mutation before showing a blueprint.",
  };
}

function evaluateUserInputRequested(input: {
  inputId: string;
  dashboardControlActions: readonly DesignerEvalDashboardControlAction[];
}): DesignerEvalCheckResult {
  const request = input.dashboardControlActions.find(
    (action) => action.kind === "request_user_input" && action.inputId === input.inputId,
  );

  return {
    passed: request !== undefined,
    label: `User input request '${input.inputId}'`,
    detail:
      request === undefined
        ? "Designer did not request this scripted user input."
        : "Designer requested this scripted user input.",
  };
}

function evaluateSavedSelectedProviderResources(input: {
  assertion: Extract<DesignerEvalAssertion, { kind: "saved-selected-provider-resources" }>;
  productStateAfter: DesignerEvalProductState;
}): DesignerEvalCheckResult {
  const matchingBinding = input.productStateAfter.targetDraft.integrationBindings.find(
    (binding) =>
      binding.connectionId === input.assertion.connectionId &&
      binding.kind === "git" &&
      configHasRepositories(binding.config, input.assertion.selectedHandles),
  );

  return {
    passed: matchingBinding !== undefined,
    label: "Saved selected provider resources",
    detail:
      matchingBinding === undefined
        ? `No git binding saved repositories ${input.assertion.selectedHandles.join(", ")} for ${input.assertion.connectionId}.`
        : `Saved repositories ${input.assertion.selectedHandles.join(", ")} on binding ${matchingBinding.id}.`,
  };
}

function responseHasSideEffect(response: unknown): boolean {
  if (typeof response !== "object" || response === null || !("contentItems" in response)) {
    return false;
  }

  const contentItems = Reflect.get(response, "contentItems");
  if (!Array.isArray(contentItems)) {
    return false;
  }

  return contentItems.some((item) => {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const text = Reflect.get(item, "text");
    return (
      typeof text === "string" && text.includes("sandbox-profile-draft-provider-resources-saved")
    );
  });
}

function configHasRepositories(config: unknown, expectedRepositories: readonly string[]): boolean {
  if (typeof config !== "object" || config === null) {
    return false;
  }

  const repositories = Reflect.get(config, "repositories");
  if (!Array.isArray(repositories)) {
    return false;
  }

  return (
    repositories.length === expectedRepositories.length &&
    expectedRepositories.every((repository) => repositories.includes(repository))
  );
}
