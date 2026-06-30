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
          requiredConcepts: ["linear", "github", "review"],
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
                  label: "Linear intake",
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
                  label: "Route review feedback",
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
      transcriptMarkdown: "Linear setup remains incomplete and must be completed manually.",
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
