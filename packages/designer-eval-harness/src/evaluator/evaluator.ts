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
  transcriptMarkdown?: string | undefined;
}): DesignerEvalResult {
  const checks = input.assertions.map((assertion) =>
    evaluateAssertion({
      assertion,
      dashboardControlActions: input.dashboardControlActions,
      productStateAfter: input.productStateAfter,
      transcriptMarkdown: input.transcriptMarkdown,
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
  transcriptMarkdown?: string | undefined;
}): DesignerEvalCheckResult {
  switch (input.assertion.kind) {
    case "blueprint-before-product-mutation":
      return evaluateBlueprintBeforeProductMutation(input.dashboardControlActions);
    case "blueprint-core-node-count-at-most":
      return evaluateBlueprintCoreNodeCountAtMost({
        actions: input.dashboardControlActions,
        maxItems: input.assertion.maxItems,
      });
    case "blueprint-has-provider-lifecycle":
      return evaluateBlueprintHasProviderLifecycle({
        actions: input.dashboardControlActions,
        requiredConcepts: input.assertion.requiredConcepts,
      });
    case "blueprint-excludes-setup-nodes":
      return evaluateBlueprintExcludesSetupNodes({
        actions: input.dashboardControlActions,
        disallowedConcepts: input.assertion.disallowedConcepts,
      });
    case "required-binding-tools-present":
      return evaluateRequiredBindingToolsPresent({
        assertion: input.assertion,
        productStateAfter: input.productStateAfter,
      });
    case "setup-incompleteness-disclosed":
      return evaluateSetupIncompletenessDisclosed({
        requiredPhrases: input.assertion.requiredPhrases,
        transcriptMarkdown: input.transcriptMarkdown,
      });
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

function evaluateBlueprintCoreNodeCountAtMost(input: {
  actions: readonly DesignerEvalDashboardControlAction[];
  maxItems: number;
}): DesignerEvalCheckResult {
  const latestBlueprint = readLatestBlueprint(input.actions);
  if (latestBlueprint === undefined) {
    return {
      passed: false,
      label: "Blueprint core node count",
      detail: "Designer did not show a blueprint.",
    };
  }

  const items = readBlueprintItems(latestBlueprint);
  if (items === undefined) {
    return {
      passed: false,
      label: "Blueprint core node count",
      detail: "Latest blueprint did not contain an items array.",
    };
  }

  return {
    passed: items.length <= input.maxItems,
    label: "Blueprint core node count",
    detail:
      items.length <= input.maxItems
        ? `Latest blueprint contains ${String(items.length)} item(s), at or below limit ${String(input.maxItems)}.`
        : `Latest blueprint contains ${String(items.length)} item(s), above limit ${String(input.maxItems)}.`,
  };
}

function evaluateBlueprintHasProviderLifecycle(input: {
  actions: readonly DesignerEvalDashboardControlAction[];
  requiredConcepts: readonly string[];
}): DesignerEvalCheckResult {
  const latestBlueprint = readLatestBlueprint(input.actions);
  const searchableText =
    latestBlueprint === undefined ? "" : collectBlueprintSearchText(latestBlueprint);
  const missingConcepts = input.requiredConcepts.filter(
    (concept) => !searchableText.includes(concept.toLowerCase()),
  );

  return {
    passed: latestBlueprint !== undefined && missingConcepts.length === 0,
    label: "Blueprint provider lifecycle",
    detail:
      latestBlueprint === undefined
        ? "Designer did not show a blueprint."
        : missingConcepts.length === 0
          ? `Latest blueprint includes required concepts: ${input.requiredConcepts.join(", ")}.`
          : `Latest blueprint is missing required concepts: ${missingConcepts.join(", ")}.`,
  };
}

function evaluateBlueprintExcludesSetupNodes(input: {
  actions: readonly DesignerEvalDashboardControlAction[];
  disallowedConcepts: readonly string[];
}): DesignerEvalCheckResult {
  const latestBlueprint = readLatestBlueprint(input.actions);
  if (latestBlueprint === undefined) {
    return {
      passed: false,
      label: "Blueprint excludes setup nodes",
      detail: "Designer did not show a blueprint.",
    };
  }

  const items = readBlueprintItems(latestBlueprint);
  if (items === undefined) {
    return {
      passed: false,
      label: "Blueprint excludes setup nodes",
      detail: "Latest blueprint did not contain an items array.",
    };
  }

  const disallowedMatches = items.flatMap((item) => {
    const itemText = collectObjectStringValues(item).join(" ").toLowerCase();
    return input.disallowedConcepts
      .filter((concept) => itemText.includes(concept.toLowerCase()))
      .map((concept) => concept);
  });

  return {
    passed: disallowedMatches.length === 0,
    label: "Blueprint excludes setup nodes",
    detail:
      disallowedMatches.length === 0
        ? "Latest blueprint does not use disallowed setup concepts as workflow nodes."
        : `Latest blueprint item text includes disallowed setup concepts: ${[
            ...new Set(disallowedMatches),
          ].join(", ")}.`,
  };
}

function evaluateRequiredBindingToolsPresent(input: {
  assertion: Extract<DesignerEvalAssertion, { kind: "required-binding-tools-present" }>;
  productStateAfter: DesignerEvalProductState;
}): DesignerEvalCheckResult {
  const matchingBinding = input.productStateAfter.targetDraft.integrationBindings.find(
    (binding) => binding.connectionId === input.assertion.connectionId,
  );
  const configuredTools =
    matchingBinding === undefined ? [] : readStringArrayProperty(matchingBinding.config, "tools");
  const missingTools = input.assertion.tools.filter((tool) => !configuredTools.includes(tool));

  return {
    passed: matchingBinding !== undefined && missingTools.length === 0,
    label: `Required binding tools for ${input.assertion.connectionId}`,
    detail:
      matchingBinding === undefined
        ? `No binding found for connection ${input.assertion.connectionId}.`
        : missingTools.length === 0
          ? `Binding ${matchingBinding.id} includes required tools: ${input.assertion.tools.join(", ")}.`
          : `Binding ${matchingBinding.id} is missing required tools: ${missingTools.join(", ")}.`,
  };
}

function evaluateSetupIncompletenessDisclosed(input: {
  requiredPhrases: readonly string[];
  transcriptMarkdown?: string | undefined;
}): DesignerEvalCheckResult {
  if (input.transcriptMarkdown === undefined) {
    return {
      passed: false,
      label: "Setup incompleteness disclosed",
      detail: "Transcript markdown was not supplied to the evaluator.",
    };
  }

  const transcriptText = input.transcriptMarkdown.toLowerCase();
  const missingPhrases = input.requiredPhrases.filter(
    (phrase) => !transcriptText.includes(phrase.toLowerCase()),
  );

  return {
    passed: missingPhrases.length === 0,
    label: "Setup incompleteness disclosed",
    detail:
      missingPhrases.length === 0
        ? `Transcript includes required disclosure phrases: ${input.requiredPhrases.join(", ")}.`
        : `Transcript is missing disclosure phrases: ${missingPhrases.join(", ")}.`,
  };
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

function readLatestBlueprint(actions: readonly DesignerEvalDashboardControlAction[]): unknown {
  const blueprintActions = actions.filter(
    (action) => action.kind === "show_designer_canvas_tab" && action.tabKind === "blueprint",
  );
  const latestAction = blueprintActions.at(-1);
  if (latestAction === undefined) {
    return undefined;
  }

  if (typeof latestAction.input !== "object" || latestAction.input === null) {
    return undefined;
  }

  return Reflect.get(latestAction.input, "blueprint");
}

function readBlueprintItems(blueprint: unknown): readonly unknown[] | undefined {
  if (typeof blueprint !== "object" || blueprint === null) {
    return undefined;
  }

  const items = Reflect.get(blueprint, "items");
  return Array.isArray(items) ? items : undefined;
}

function collectBlueprintSearchText(blueprint: unknown): string {
  return collectObjectStringValues(blueprint).join(" ").toLowerCase();
}

function collectObjectStringValues(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectObjectStringValues(entry));
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.values(value).flatMap((entry) => collectObjectStringValues(entry));
}

function readStringArrayProperty(value: unknown, property: string): readonly string[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const propertyValue = Reflect.get(value, property);
  if (!Array.isArray(propertyValue)) {
    return [];
  }

  return propertyValue.filter((entry) => typeof entry === "string");
}
