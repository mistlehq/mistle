import { describe, expect, it } from "vitest";

import type {
  DesignerEvalDashboardControlAction,
  DesignerEvalProductState,
  DesignerEvalProductStateIntegrationBinding,
} from "../types.ts";
import { evaluateDesignerEvalRun, renderEvaluationMarkdown } from "./evaluator.ts";

describe("Designer eval evaluator", () => {
  it("passes when Designer shows a blueprint before saving selected provider resources", () => {
    const actions: DesignerEvalDashboardControlAction[] = [
      {
        sequence: 1,
        kind: "show_designer_canvas_tab",
        tabKind: "blueprint",
        input: {},
        response: {},
      },
      {
        sequence: 2,
        kind: "request_user_input",
        inputId: "select_repository",
        input: {},
        response: {
          success: true,
          contentItems: [
            {
              type: "inputText",
              text: '{"kind":"sandbox-profile-draft-provider-resources-saved"}',
            },
          ],
        },
      },
    ];
    const productStateAfter = createGithubProductState({
      integrationBindings: [
        {
          id: "ibd_saved",
          connectionId: "icn_eval_github_pr_review_basic_repo",
          kind: "git",
          config: {
            repositories: ["mistlehq/mistle"],
          },
        },
      ],
    });

    const result = evaluateDesignerEvalRun({
      caseId: "github-pr-review-basic",
      assertions: [
        {
          kind: "blueprint-before-product-mutation",
        },
        {
          kind: "user-input-requested",
          inputId: "select_repository",
        },
        {
          kind: "saved-selected-provider-resources",
          connectionId: "icn_eval_github_pr_review_basic_repo",
          selectedHandles: ["mistlehq/mistle"],
        },
      ],
      dashboardControlActions: actions,
      productStateAfter,
      transcriptMarkdown: "GitHub repository setup is complete.",
    });

    expect(result.passed).toBe(true);
    expect(renderEvaluationMarkdown(result)).toContain("Status: PASS");
  });

  it("fails when the product mutation happens before the first blueprint", () => {
    const result = evaluateDesignerEvalRun({
      caseId: "github-pr-review-basic",
      assertions: [
        {
          kind: "blueprint-before-product-mutation",
        },
      ],
      dashboardControlActions: [
        {
          sequence: 1,
          kind: "request_user_input",
          inputId: "select_repository",
          input: {},
          response: {
            success: true,
            contentItems: [
              {
                type: "inputText",
                text: '{"kind":"sandbox-profile-draft-provider-resources-saved"}',
              },
            ],
          },
        },
        {
          sequence: 2,
          kind: "show_designer_canvas_tab",
          tabKind: "blueprint",
          input: {},
          response: {},
        },
      ],
      productStateAfter: createGithubProductState({ integrationBindings: [] }),
    });

    expect(result.passed).toBe(false);
    expect(result.checks[0]?.detail).toContain("before showing a blueprint");
  });

  it("fails when saved selected provider resources include unselected repositories", () => {
    const result = evaluateDesignerEvalRun({
      caseId: "github-pr-review-basic",
      assertions: [
        {
          kind: "saved-selected-provider-resources",
          connectionId: "icn_eval_github_pr_review_basic_repo",
          selectedHandles: ["mistlehq/mistle"],
        },
      ],
      dashboardControlActions: [],
      productStateAfter: createGithubProductState({
        integrationBindings: [
          {
            id: "ibd_saved",
            connectionId: "icn_eval_github_pr_review_basic_repo",
            kind: "git",
            config: {
              repositories: ["mistlehq/mistle", "mistlehq/other"],
            },
          },
        ],
      }),
    });

    expect(result.passed).toBe(false);
  });

  it("checks blueprint shape, required binding tools, and setup disclosure", () => {
    const result = evaluateDesignerEvalRun({
      caseId: "ai-software-factory-linear-github",
      assertions: [
        {
          kind: "blueprint-core-node-count-at-most",
          maxItems: 5,
        },
        {
          kind: "blueprint-has-provider-lifecycle",
          requiredConcepts: ["linear", "github", "ready", "review", "feedback", "status"],
        },
        {
          kind: "blueprint-excludes-setup-nodes",
          disallowedConcepts: ["publish", "repository selection"],
        },
        {
          kind: "required-binding-tools-present",
          connectionId: "icn_github",
          tools: ["github-cli"],
        },
        {
          kind: "setup-incompleteness-disclosed",
          requiredPhrases: ["linear", "setup"],
        },
      ],
      dashboardControlActions: [
        {
          sequence: 1,
          kind: "show_designer_canvas_tab",
          tabKind: "blueprint",
          input: {
            kind: "blueprint",
            title: "AI software factory",
            blueprint: {
              version: 1,
              outcome: {
                label: "Move Linear work through GitHub implementation and review",
              },
              items: [
                {
                  id: "linear-intake",
                  kind: "trigger",
                  label: "Linear ready issue intake",
                  state: "proposed",
                },
                {
                  id: "github-work",
                  kind: "agent_step",
                  label: "Create GitHub implementation branch and PR",
                  state: "proposed",
                },
                {
                  id: "review-loop",
                  kind: "agent_step",
                  label: "Route review feedback and update Linear status",
                  state: "proposed",
                },
              ],
            },
          },
          response: {},
        },
      ],
      productStateAfter: {
        providerConnections: [
          {
            id: "icn_github",
            label: "GitHub",
            providerFamilyId: "github",
            targetKey: "github-cloud",
          },
        ],
        availableProviderResources: [],
        targetDraft: {
          profileId: "sbp_eval",
          version: 1,
          integrationBindings: [
            {
              id: "ibd_github",
              connectionId: "icn_github",
              kind: "git",
              config: {
                repositories: ["mistlehq/mistle"],
                tools: ["github-cli"],
              },
            },
          ],
        },
      },
      transcriptMarkdown:
        "Linear setup remains incomplete. Configure labels and statuses before calling the factory ready.",
    });

    expect(result.passed).toBe(true);
  });

  it("fails when the transcript claims configured provider tools are still missing", () => {
    const result = evaluateDesignerEvalRun({
      caseId: "ai-software-factory-linear-github",
      assertions: [
        {
          kind: "configured-tools-not-claimed-missing",
          connectionTools: [
            {
              connectionId: "icn_linear",
              tools: ["linear-mcp"],
            },
            {
              connectionId: "icn_github",
              tools: ["github-cli"],
            },
          ],
          forbiddenPhrases: [
            "Bind Linear with `linear-mcp`",
            "Verify GitHub binding includes `github-cli`",
          ],
        },
      ],
      dashboardControlActions: [],
      productStateAfter: createAiFactoryProductState({
        linearTools: ["linear-mcp"],
        githubTools: ["github-cli"],
      }),
      transcriptMarkdown:
        "Still remaining: Bind Linear with `linear-mcp`. Verify GitHub binding includes `github-cli`.",
    });

    expect(result.passed).toBe(false);
    expect(result.checks[0]?.detail).toContain("already configured");
  });

  it("skips configured-tool claim checks when required tools are not configured", () => {
    const result = evaluateDesignerEvalRun({
      caseId: "ai-software-factory-linear-github",
      assertions: [
        {
          kind: "configured-tools-not-claimed-missing",
          connectionTools: [
            {
              connectionId: "icn_linear",
              tools: ["linear-mcp"],
            },
          ],
          forbiddenPhrases: ["Bind Linear with `linear-mcp`"],
        },
      ],
      dashboardControlActions: [],
      productStateAfter: createAiFactoryProductState({
        linearTools: [],
        githubTools: ["github-cli"],
      }),
      transcriptMarkdown: "Still remaining: Bind Linear with `linear-mcp`.",
    });

    expect(result.passed).toBe(true);
    expect(result.checks[0]?.detail).toContain("skipped");
  });

  it("fails when the transcript includes internal tool-probing narration", () => {
    const result = evaluateDesignerEvalRun({
      caseId: "ai-software-factory-linear-github",
      assertions: [
        {
          kind: "transcript-excludes-internal-progress",
          forbiddenPhrases: ["I’m going to check the available Mistle tools"],
        },
      ],
      dashboardControlActions: [],
      productStateAfter: createAiFactoryProductState({
        linearTools: ["linear-mcp"],
        githubTools: ["github-cli"],
      }),
      transcriptMarkdown:
        "I’m going to check the available Mistle tools before I explain the next setup step.",
    });

    expect(result.passed).toBe(false);
    expect(result.checks[0]?.detail).toContain("internal tool-probing");
  });

  it("checks required handoff phrases in the transcript", () => {
    const result = evaluateDesignerEvalRun({
      caseId: "ai-software-factory-linear-github",
      assertions: [
        {
          kind: "transcript-includes-required-phrases",
          label: "Factory handoff",
          requiredPhrases: [
            "Implementation agent instructions",
            "Review agent instructions",
            "Ready -> Agent In Progress -> Ready for Review",
            "operating guide",
          ],
        },
      ],
      dashboardControlActions: [],
      productStateAfter: createAiFactoryProductState({
        linearTools: ["linear-mcp"],
        githubTools: ["github-cli"],
      }),
      transcriptMarkdown:
        "Implementation agent instructions. Review agent instructions. Ready -> Agent In Progress -> Ready for Review. I can create an operating guide next.",
    });

    expect(result.passed).toBe(true);
  });

  it("checks required handoff sections in the transcript", () => {
    const result = evaluateDesignerEvalRun({
      caseId: "ai-software-factory-handoff-quality",
      assertions: [
        {
          kind: "transcript-includes-sections",
          label: "Factory handoff sections",
          requiredSections: [
            "Implementation agent instructions",
            "Review agent instructions",
            "Linear status mapping",
            "Human operating guide",
            "Configuration shape",
            "Next action",
          ],
        },
      ],
      dashboardControlActions: [],
      productStateAfter: createAiFactoryProductState({
        linearTools: ["linear-mcp"],
        githubTools: ["github-cli"],
      }),
      transcriptMarkdown: [
        "**Implementation agent instructions**",
        "**Review agent instructions**",
        "**Linear status mapping**",
        "**Human operating guide**",
        "**Configuration shape**",
        "**Next action:** review the draft.",
      ].join("\n\n"),
    });

    expect(result.passed).toBe(true);
  });
});

function createGithubProductState(input: {
  integrationBindings: readonly DesignerEvalProductStateIntegrationBinding[];
}): DesignerEvalProductState {
  return {
    providerConnections: [
      {
        id: "icn_eval_github_pr_review_basic_repo",
        label: "GitHub",
        providerFamilyId: "github",
        targetKey: "github-cloud",
      },
    ],
    availableProviderResources: [
      {
        connectionId: "icn_eval_github_pr_review_basic_repo",
        kind: "repository",
        handle: "mistlehq/mistle",
      },
    ],
    targetDraft: {
      profileId: "sbp_eval_github_pr_review_basic",
      version: 1,
      integrationBindings: input.integrationBindings,
    },
  };
}

function createAiFactoryProductState(input: {
  linearTools: readonly string[];
  githubTools: readonly string[];
}): DesignerEvalProductState {
  return {
    providerConnections: [
      {
        id: "icn_linear",
        label: "Linear",
        providerFamilyId: "linear",
        targetKey: "linear-default",
      },
      {
        id: "icn_github",
        label: "GitHub",
        providerFamilyId: "github",
        targetKey: "github-cloud",
      },
    ],
    availableProviderResources: [],
    targetDraft: {
      profileId: "sbp_eval_ai_factory",
      version: 1,
      integrationBindings: [
        {
          id: "ibd_linear",
          connectionId: "icn_linear",
          kind: "connector",
          config: {
            tools: [...input.linearTools],
          },
        },
        {
          id: "ibd_github",
          connectionId: "icn_github",
          kind: "git",
          config: {
            tools: [...input.githubTools],
          },
        },
      ],
    },
  };
}
