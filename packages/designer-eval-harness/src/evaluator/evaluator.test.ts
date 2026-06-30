import { describe, expect, it } from "vitest";

import type { DesignerEvalDashboardControlAction, DesignerEvalProductState } from "../types.ts";
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
    const productStateAfter: DesignerEvalProductState = {
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
      },
    };

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
          profileId: "sbp_eval_github_pr_review_basic",
          version: 1,
          connectionId: "icn_eval_github_pr_review_basic_repo",
          resourceKind: "repository",
          bindingIntent: "git-repositories",
          selectedHandles: ["mistlehq/mistle"],
        },
      ],
      dashboardControlActions: actions,
      productStateAfter,
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
      productStateAfter: {
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
          integrationBindings: [],
        },
      },
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
          profileId: "sbp_eval_github_pr_review_basic",
          version: 1,
          connectionId: "icn_eval_github_pr_review_basic_repo",
          resourceKind: "repository",
          bindingIntent: "git-repositories",
          selectedHandles: ["mistlehq/mistle"],
        },
      ],
      dashboardControlActions: [],
      productStateAfter: {
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
        },
      },
    });

    expect(result.passed).toBe(false);
  });
});
