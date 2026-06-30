import type { DesignerEvalCase, DesignerEvalInputResponse } from "../types.ts";

type ScriptedAnswerValue = string | readonly string[];

function scriptedAnswerAliases(
  ids: readonly string[],
  value: ScriptedAnswerValue,
): Record<string, DesignerEvalInputResponse> {
  const responses: Record<string, DesignerEvalInputResponse> = {};

  for (const id of ids) {
    responses[id] = {
      kind: "answers",
      answers: [
        {
          id,
          value,
        },
      ],
    };
  }

  return responses;
}

const GithubPrReviewBasicCase: DesignerEvalCase = {
  id: "github-pr-review-basic",
  expectedOutcomePath: "docs/cases/github-pr-review-basic.md",
  prompt: "Help me build an agent that reviews GitHub pull requests.",
  seed: {
    providerConnections: [
      {
        id: "icn_eval_github_pr_review_basic_repo",
        label: "GitHub",
        providerFamilyId: "github",
        targetKey: "github-cloud",
      },
    ],
    providerResources: [
      {
        connectionId: "icn_eval_github_pr_review_basic_repo",
        kind: "repository",
        handle: "mistlehq/mistle",
      },
    ],
    targetDraft: {
      profileId: "sbp_eval_github_pr_review_basic",
      version: 1,
    },
  },
  scriptedInputs: {
    pr_review_trigger_scope: {
      kind: "answers",
      answers: [
        {
          id: "pr_review_trigger_scope",
          value: "Opened, updated, ready",
        },
      ],
    },
    pr_trigger_scope: {
      kind: "answers",
      answers: [
        {
          id: "pr_trigger_scope",
          value: "Opened, updated, ready",
        },
      ],
    },
    select_github_repositories: {
      kind: "answers",
      answers: [
        {
          id: "select_github_repositories",
          value: ["mistlehq/mistle"],
        },
      ],
    },
    select_repository: {
      kind: "answers",
      answers: [
        {
          id: "select_repository",
          value: ["mistlehq/mistle"],
        },
      ],
    },
    approval_boundary: {
      kind: "answers",
      answers: [
        {
          id: "approval_boundary",
          value: "Ask before posting review comments",
        },
      ],
    },
  },
  assertions: [
    {
      kind: "blueprint-before-product-mutation",
    },
    {
      kind: "saved-selected-provider-resources",
      connectionId: "icn_eval_github_pr_review_basic_repo",
      selectedHandles: ["mistlehq/mistle"],
    },
  ],
};

const AiSoftwareFactoryLinearGithubCase: DesignerEvalCase = {
  id: "ai-software-factory-linear-github",
  expectedOutcomePath: "docs/cases/ai-software-factory.md",
  prompt: "Build an AI software factory with Linear and GitHub.",
  seed: {
    providerConnections: [
      {
        id: "icn_eval_ai_factory_github",
        label: "GitHub",
        providerFamilyId: "github",
        targetKey: "github-cloud",
      },
      {
        id: "icn_eval_ai_factory_linear",
        label: "Linear",
        providerFamilyId: "linear",
        targetKey: "linear-default",
      },
    ],
    providerResources: [
      {
        connectionId: "icn_eval_ai_factory_github",
        kind: "repository",
        handle: "mistlehq/mistle",
      },
    ],
    targetDraft: {
      profileId: "sbp_eval_ai_software_factory",
      version: 1,
      initialIntegrationBindings: [
        {
          id: "ibd_eval_ai_factory_agent",
          connectionId: "icn_eval_ai_factory_agent",
          kind: "agent",
          config: {},
        },
        {
          id: "ibd_eval_ai_factory_linear",
          connectionId: "icn_eval_ai_factory_linear",
          kind: "connector",
          config: {
            tools: ["linear-mcp"],
          },
        },
        {
          id: "ibd_eval_ai_factory_github",
          connectionId: "icn_eval_ai_factory_github",
          kind: "git",
          config: {
            tools: ["github-cli"],
          },
        },
      ],
    },
  },
  scriptedInputs: {
    ...scriptedAnswerAliases(
      [
        "select_github_repositories",
        "select_github_repository",
        "select_github_repo",
        "github_repository_selection",
        "github_repository",
        "github_repo",
        "repository_selection",
        "select_repository",
      ],
      ["mistlehq/mistle"],
    ),
    ...scriptedAnswerAliases(
      [
        "confirm_operating_model",
        "confirm_ai_factory_model",
        "ai_factory_operating_model",
        "ai_software_factory_operating_model",
        "software_factory_operating_model",
        "confirm_factory_model",
        "factory_operating_model",
      ],
      "Add review agent",
    ),
    ...scriptedAnswerAliases(
      [
        "workflow_approval_boundary",
        "approval_boundary",
        "pr_approval_boundary",
        "pr_handoff_boundary",
        "handoff_boundary",
        "human_review_boundary",
      ],
      "Ask before creating pull requests or posting Linear updates",
    ),
    ...scriptedAnswerAliases(["linear_start_boundary"], "Ready for AI"),
    ...scriptedAnswerAliases(["linear_trigger_scope"], "Ready state"),
    ...scriptedAnswerAliases(
      [
        "linear_intake_rule",
        "linear_ready_signal",
        "linear_ready_state",
        "linear_ready_scope",
        "linear_readiness_rule",
        "linear_pickup_rule",
        "readiness_rule",
      ],
      "Ready status",
    ),
    ...scriptedAnswerAliases(
      [
        "next_action",
        "next_factory_step",
        "next_setup_action",
        "next_setup_step",
        "profile_config_next_step",
        "profile_configuration_next_step",
        "next_profile_action",
      ],
      "Stop here",
    ),
    ...scriptedAnswerAliases(
      [
        "pull_request_mode",
        "pr_mode",
        "pr_creation_mode",
        "pr_review_mode",
        "pull_request_review_mode",
        "review_mode",
      ],
      "Draft PRs",
    ),
  },
  assertions: [
    {
      kind: "blueprint-before-product-mutation",
    },
    {
      kind: "blueprint-core-node-count-at-most",
      maxItems: 8,
    },
    {
      kind: "blueprint-has-provider-lifecycle",
      requiredConcepts: ["linear", "github", "ready", "review", "feedback", "status"],
    },
    {
      kind: "blueprint-excludes-setup-nodes",
      disallowedConcepts: ["publish", "profile selection", "repository selection"],
    },
    {
      kind: "required-binding-tools-present",
      connectionId: "icn_eval_ai_factory_github",
      tools: ["github-cli"],
    },
    {
      kind: "required-binding-tools-present",
      connectionId: "icn_eval_ai_factory_linear",
      tools: ["linear-mcp"],
    },
    {
      kind: "setup-incompleteness-disclosed",
      requiredPhrases: ["linear", "setup", "labels", "statuses"],
    },
  ],
};

const Cases = [GithubPrReviewBasicCase, AiSoftwareFactoryLinearGithubCase];

export function listDesignerEvalCases(): readonly DesignerEvalCase[] {
  return Cases;
}

export function getDesignerEvalCase(caseId: string): DesignerEvalCase {
  const evalCase = Cases.find((candidate) => candidate.id === caseId);
  if (evalCase === undefined) {
    throw new Error(
      `Unknown Designer eval case '${caseId}'. Available cases: ${Cases.map((candidate) => candidate.id).join(", ")}`,
    );
  }

  return evalCase;
}
