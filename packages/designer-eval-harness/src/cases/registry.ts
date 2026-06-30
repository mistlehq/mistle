import type { DesignerEvalCase } from "../types.ts";

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
      profileId: "sbp_eval_github_pr_review_basic",
      version: 1,
      connectionId: "icn_eval_github_pr_review_basic_repo",
      resourceKind: "repository",
      bindingIntent: "git-repositories",
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
    workflow_approval_boundary: {
      kind: "answers",
      answers: [
        {
          id: "workflow_approval_boundary",
          value: "Ask before creating pull requests or posting Linear updates",
        },
      ],
    },
    approval_boundary: {
      kind: "answers",
      answers: [
        {
          id: "approval_boundary",
          value: "Ask before creating pull requests or posting Linear updates",
        },
      ],
    },
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
      requiredConcepts: ["linear", "github", "review", "status"],
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
      requiredPhrases: ["linear", "setup"],
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
