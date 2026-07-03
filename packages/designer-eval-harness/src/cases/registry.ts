import type { DesignerEvalCase, DesignerEvalInputResponse } from "../types.ts";
import { DesignerEvalDecisionIds } from "./decision-ids.ts";

type ScriptedAnswerValue = string | readonly string[];

const AiFactoryInternalProgressForbiddenPhrases = [
  "I’m going to check the available Mistle tools",
  "I only have the dashboard-control path",
  "no product mutation MCP tools were exposed",
  "I’ll save the reversible profile configuration",
];

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
  followUpPrompts: [
    "The blueprint direction looks right. Use mistlehq/mistle, review opened and updated pull requests, and ask before posting review comments.",
  ],
  seed: {
    providerConnections: [
      {
        id: "icn_eval_github_pr_review_basic_agent",
        label: "OpenAI",
        providerFamilyId: "openai",
        targetKey: "openai-default",
      },
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
      initialIntegrationBindings: [
        {
          id: "ibd_eval_github_pr_review_basic_agent",
          connectionId: "icn_eval_github_pr_review_basic_agent",
          kind: "agent",
          config: {},
        },
        {
          id: "ibd_eval_github_pr_review_basic_repo",
          connectionId: "icn_eval_github_pr_review_basic_repo",
          kind: "git",
          config: {
            tools: ["github-cli"],
          },
        },
      ],
    },
  },
  scriptedInputs: {
    [DesignerEvalDecisionIds.PR_REVIEW_TRIGGER_SCOPE]: {
      kind: "answers",
      answers: [
        {
          id: DesignerEvalDecisionIds.PR_REVIEW_TRIGGER_SCOPE,
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
    [DesignerEvalDecisionIds.GITHUB_REPOSITORY_SELECTION]: {
      kind: "answers",
      answers: [
        {
          id: DesignerEvalDecisionIds.GITHUB_REPOSITORY_SELECTION,
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
    [DesignerEvalDecisionIds.APPROVAL_BOUNDARY]: {
      kind: "answers",
      answers: [
        {
          id: DesignerEvalDecisionIds.APPROVAL_BOUNDARY,
          value: "Ask before posting review comments",
        },
      ],
    },
    [DesignerEvalDecisionIds.NEXT_SETUP_ACTION]: {
      kind: "answers",
      answers: [
        {
          id: DesignerEvalDecisionIds.NEXT_SETUP_ACTION,
          value: "Stop here",
        },
      ],
    },
  },
  assertions: [
    {
      kind: "blueprint-before-product-mutation",
    },
    {
      kind: "product-mutation-not-before-turn",
      minTurnIndex: 1,
    },
    {
      kind: "saved-selected-provider-resources",
      connectionId: "icn_eval_github_pr_review_basic_repo",
      selectedHandles: ["mistlehq/mistle"],
    },
    {
      kind: "blueprint-has-provider-lifecycle",
      requiredConcepts: ["github", "pull request", "review"],
    },
    {
      kind: "blueprint-excludes-setup-nodes",
      disallowedConcepts: ["publish", "repository selection"],
    },
    {
      kind: "required-binding-tools-present",
      connectionId: "icn_eval_github_pr_review_basic_repo",
      tools: ["github-cli"],
    },
    {
      kind: "required-agent-model-provider-binding",
      connectionId: "icn_eval_github_pr_review_basic_agent",
      compatibleTargetKeys: ["openai-default"],
    },
    {
      kind: "setup-incompleteness-disclosed",
      requiredPhrases: ["approval"],
    },
  ],
};

const AiSoftwareFactoryLinearGithubCase: DesignerEvalCase = {
  id: "ai-software-factory-linear-github",
  expectedOutcomePath: "docs/cases/ai-software-factory.md",
  prompt: "Build an AI software factory with Linear and GitHub.",
  followUpPrompts: [
    "The proposed workflow direction is right. Use mistlehq/mistle, use a Ready status as the pickup rule, map statuses as Ready for Agent -> Agent In Progress -> Ready for Review -> Needs Rework / Blocked -> Done, keep implementation and review role-separated in one sandbox profile, and ask before creating pull requests or posting Linear updates.",
  ],
  seed: {
    providerConnections: [
      {
        id: "icn_eval_ai_factory_agent",
        label: "OpenAI",
        providerFamilyId: "openai",
        targetKey: "openai-default",
      },
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
        DesignerEvalDecisionIds.GITHUB_REPOSITORY_SELECTION,
        "github_repository",
        "github_repo",
        "repository_selection",
        "select_repository",
      ],
      ["mistlehq/mistle"],
    ),
    ...scriptedAnswerAliases(
      [
        "confirm_ai_factory_plan",
        "ai_factory_plan",
        "ai_software_factory_plan",
        "software_factory_plan",
        "confirm_factory_plan",
        "factory_plan",
      ],
      "Add review agent",
    ),
    ...scriptedAnswerAliases(
      [
        "workflow_approval_boundary",
        DesignerEvalDecisionIds.APPROVAL_BOUNDARY,
        "pr_approval_boundary",
        "pr_readiness_boundary",
        "readiness_boundary",
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
        DesignerEvalDecisionIds.LINEAR_PICKUP_RULE,
        "readiness_rule",
      ],
      "Ready status",
    ),
    ...scriptedAnswerAliases(
      [DesignerEvalDecisionIds.LINEAR_STATUS_MAPPING],
      "Ready for Agent -> Agent In Progress -> Ready for Review -> Needs Rework / Blocked -> Done",
    ),
    ...scriptedAnswerAliases(
      [
        DesignerEvalDecisionIds.CONFIGURATION_SHAPE,
        "profile_configuration_shape",
        "agent_role_configuration",
      ],
      "One sandbox profile with role-separated implementation and review instructions",
    ),
    ...scriptedAnswerAliases(
      [
        "next_action",
        "next_factory_step",
        DesignerEvalDecisionIds.NEXT_SETUP_ACTION,
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
      kind: "product-mutation-not-before-turn",
      minTurnIndex: 1,
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
      kind: "required-agent-model-provider-binding",
      connectionId: "icn_eval_ai_factory_agent",
      compatibleTargetKeys: ["openai-default"],
    },
    {
      kind: "setup-incompleteness-disclosed",
      requiredPhrases: ["linear", "Ready for Agent", "trigger"],
    },
    {
      kind: "configured-tools-not-claimed-missing",
      connectionTools: [
        {
          connectionId: "icn_eval_ai_factory_github",
          tools: ["github-cli"],
        },
        {
          connectionId: "icn_eval_ai_factory_linear",
          tools: ["linear-mcp"],
        },
      ],
      forbiddenPhrases: [
        "Bind Linear with `linear-mcp`",
        "Verify GitHub binding includes `github-cli`",
        "ensure GitHub CLI and Linear MCP are selected",
        "ensure the sandbox profile exposes the Linear MCP tool and GitHub CLI tool",
        "ensure provider tools are selected",
      ],
    },
    {
      kind: "transcript-excludes-internal-progress",
      forbiddenPhrases: AiFactoryInternalProgressForbiddenPhrases,
    },
    {
      kind: "transcript-includes-required-phrases",
      label: "Factory configuration next steps",
      requiredPhrases: [
        "Implementation agent instructions",
        "Review agent instructions",
        "Ready for Agent -> Agent In Progress -> Ready for Review",
        "operating guide",
        "Configuration shape",
        "one sandbox profile",
        "role-separated",
        "Next action",
      ],
    },
  ],
};

const AiSoftwareFactoryNextStepQualityCase: DesignerEvalCase = {
  ...AiSoftwareFactoryLinearGithubCase,
  id: "ai-software-factory-next-step-quality",
  prompt:
    "Build an AI software factory with Linear and GitHub. Stop once the blueprint, repository choice, approval boundary, and profile configuration next steps are ready.",
  assertions: [
    {
      kind: "transcript-includes-required-phrases",
      label: "Factory configuration next steps",
      requiredPhrases: [
        "Implementation agent instructions",
        "Review agent instructions",
        "Ready for Agent -> Agent In Progress -> Ready for Review",
        "operating guide",
        "Configuration shape",
        "one sandbox profile",
        "role-separated",
        "Next action",
      ],
    },
    {
      kind: "transcript-excludes-internal-progress",
      forbiddenPhrases: AiFactoryInternalProgressForbiddenPhrases,
    },
  ],
};

const Cases = [
  GithubPrReviewBasicCase,
  AiSoftwareFactoryLinearGithubCase,
  AiSoftwareFactoryNextStepQualityCase,
];

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
