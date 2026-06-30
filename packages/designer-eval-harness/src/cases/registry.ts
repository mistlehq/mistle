import type { DesignerEvalCase } from "../types.ts";

const GithubPrReviewBasicCase: DesignerEvalCase = {
  id: "github-pr-review-basic",
  prompt: "Help me build an agent that reviews GitHub pull requests.",
  seed: {
    githubRepositoryHandles: ["mistlehq/mistle"],
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

const Cases = [GithubPrReviewBasicCase];

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
