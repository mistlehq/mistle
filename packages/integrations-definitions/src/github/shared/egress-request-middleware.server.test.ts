import { describe, expect, it } from "vitest";

import { AppendSessionLinkToGitHubMarkdownRequestMiddleware } from "./egress-request-middleware.server.js";

const SessionUrl = "https://control-plane.example.test/p/sessions/sandbox_123";

function createGitHubRequest(input: {
  pathname: string;
  body: unknown;
  baseUrl?: string;
  method?: string;
}) {
  return {
    method: input.method ?? "POST",
    url: new URL(`${input.baseUrl ?? "https://api.github.com"}${input.pathname}`),
    headers: new Headers({
      "content-type": "application/json",
    }),
    body: new TextEncoder().encode(JSON.stringify(input.body)),
  };
}

describe("AppendSessionLinkToGitHubMarkdownRequestMiddleware", () => {
  it("appends a markdown footer to issue and pull request bodies", async () => {
    const issueRequest = createGitHubRequest({
      pathname: "/repos/mistlehq/mistle/issues",
      body: {
        title: "Issue title",
        body: "Issue body",
      },
    });
    const pullRequest = createGitHubRequest({
      pathname: "/repos/mistlehq/mistle/pulls",
      body: {
        title: "PR title",
        head: "feature",
        base: "main",
        body: "PR body",
      },
    });

    const issueResult = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: issueRequest,
    });
    const pullResult = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: pullRequest,
    });

    expect(JSON.parse(new TextDecoder().decode(issueResult.body))).toEqual({
      title: "Issue title",
      body: `Issue body\n\n---\n[🔗 View session](${SessionUrl})`,
    });
    expect(JSON.parse(new TextDecoder().decode(pullResult.body))).toEqual({
      title: "PR title",
      head: "feature",
      base: "main",
      body: `PR body\n\n---\n[🔗 View session](${SessionUrl})`,
    });
  });

  it("appends the markdown footer to issue and pull request comments", async () => {
    const issueCommentRequest = createGitHubRequest({
      pathname: "/repos/mistlehq/mistle/issues/123/comments",
      body: {
        body: "Issue comment",
      },
    });
    const pullCommentRequest = createGitHubRequest({
      pathname: "/repos/mistlehq/mistle/pulls/456/comments",
      body: {
        body: "Pull request review comment",
      },
    });

    const issueCommentResult = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: issueCommentRequest,
    });
    const pullCommentResult = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: pullCommentRequest,
    });

    expect(JSON.parse(new TextDecoder().decode(issueCommentResult.body))).toEqual({
      body: `Issue comment\n\n---\n[🔗 View session](${SessionUrl})`,
    });
    expect(JSON.parse(new TextDecoder().decode(pullCommentResult.body))).toEqual({
      body: `Pull request review comment\n\n---\n[🔗 View session](${SessionUrl})`,
    });
  });

  it("appends the markdown footer to GraphQL addComment mutations", async () => {
    const request = createGitHubRequest({
      pathname: "/graphql",
      body: {
        query:
          "mutation CommentCreate($input:AddCommentInput!){addComment(input: $input){commentEdge{node{url}}}}",
        variables: {
          input: {
            subjectId: "I_kwDOExample",
            body: "Issue comment from gh",
          },
        },
      },
    });

    const result = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    expect(JSON.parse(new TextDecoder().decode(result.body))).toEqual({
      query:
        "mutation CommentCreate($input:AddCommentInput!){addComment(input: $input){commentEdge{node{url}}}}",
      variables: {
        input: {
          subjectId: "I_kwDOExample",
          body: `Issue comment from gh\n\n---\n[🔗 View session](${SessionUrl})`,
        },
      },
    });
  });

  it("appends the markdown footer to GraphQL pull request create and update mutations", async () => {
    const createPullRequest = createGitHubRequest({
      pathname: "/graphql",
      body: {
        operationName: "CreatePullRequest",
        query:
          "mutation CreatePullRequest($input:CreatePullRequestInput!){createPullRequest(input: $input){pullRequest{id}}}",
        variables: {
          input: {
            repositoryId: "R_kgDOExample",
            title: "PR title",
            headRefName: "feature",
            baseRefName: "main",
            body: "PR body",
          },
        },
      },
    });
    const updatePullRequest = createGitHubRequest({
      pathname: "/graphql",
      body: {
        operationName: "UpdatePullRequest",
        query:
          "mutation UpdatePullRequest($input:UpdatePullRequestInput!){updatePullRequest(input: $input){pullRequest{id}}}",
        variables: {
          input: {
            pullRequestId: "PR_kwDOExample",
            body: "Updated PR body",
          },
        },
      },
    });

    const createResult = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: createPullRequest,
    });
    const updateResult = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: updatePullRequest,
    });

    expect(JSON.parse(new TextDecoder().decode(createResult.body))).toEqual({
      operationName: "CreatePullRequest",
      query:
        "mutation CreatePullRequest($input:CreatePullRequestInput!){createPullRequest(input: $input){pullRequest{id}}}",
      variables: {
        input: {
          repositoryId: "R_kgDOExample",
          title: "PR title",
          headRefName: "feature",
          baseRefName: "main",
          body: `PR body\n\n---\n[🔗 View session](${SessionUrl})`,
        },
      },
    });
    expect(JSON.parse(new TextDecoder().decode(updateResult.body))).toEqual({
      operationName: "UpdatePullRequest",
      query:
        "mutation UpdatePullRequest($input:UpdatePullRequestInput!){updatePullRequest(input: $input){pullRequest{id}}}",
      variables: {
        input: {
          pullRequestId: "PR_kwDOExample",
          body: `Updated PR body\n\n---\n[🔗 View session](${SessionUrl})`,
        },
      },
    });
  });

  it("appends the markdown footer when the selected GraphQL operation uses a fragment spread for a pull request mutation", async () => {
    const request = createGitHubRequest({
      pathname: "/graphql",
      body: {
        operationName: "CreatePullRequest",
        query: [
          "mutation CreatePullRequest($input:CreatePullRequestInput!){",
          "  ...CreatePullRequestMutation",
          "}",
          "fragment CreatePullRequestMutation on Mutation {",
          "  createPullRequest(input: $input) { pullRequest { id } }",
          "}",
        ].join("\n"),
        variables: {
          input: {
            repositoryId: "R_kgDOExample",
            title: "PR title",
            headRefName: "feature",
            baseRefName: "main",
            body: "PR body from fragment",
          },
        },
      },
    });

    const result = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    expect(JSON.parse(new TextDecoder().decode(result.body))).toEqual({
      operationName: "CreatePullRequest",
      query: [
        "mutation CreatePullRequest($input:CreatePullRequestInput!){",
        "  ...CreatePullRequestMutation",
        "}",
        "fragment CreatePullRequestMutation on Mutation {",
        "  createPullRequest(input: $input) { pullRequest { id } }",
        "}",
      ].join("\n"),
      variables: {
        input: {
          repositoryId: "R_kgDOExample",
          title: "PR title",
          headRefName: "feature",
          baseRefName: "main",
          body: `PR body from fragment\n\n---\n[🔗 View session](${SessionUrl})`,
        },
      },
    });
  });

  it("does not mutate the selected GraphQL operation when an unused pull request mutation is also present", async () => {
    const request = createGitHubRequest({
      pathname: "/graphql",
      body: {
        operationName: "CreateIssue",
        query: [
          "mutation CreatePullRequest($input:CreatePullRequestInput!){",
          "  createPullRequest(input: $input) { pullRequest { id } }",
          "}",
          "mutation CreateIssue($input:CreateIssueInput!){",
          "  createIssue(input: $input) { issue { id } }",
          "}",
        ].join("\n"),
        variables: {
          input: {
            repositoryId: "R_kgDOExample",
            title: "Issue title",
            body: "Issue body",
          },
        },
      },
    });

    const result = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    expect(JSON.parse(new TextDecoder().decode(result.body))).toEqual({
      operationName: "CreateIssue",
      query: [
        "mutation CreatePullRequest($input:CreatePullRequestInput!){",
        "  createPullRequest(input: $input) { pullRequest { id } }",
        "}",
        "mutation CreateIssue($input:CreateIssueInput!){",
        "  createIssue(input: $input) { issue { id } }",
        "}",
      ].join("\n"),
      variables: {
        input: {
          repositoryId: "R_kgDOExample",
          title: "Issue title",
          body: "Issue body",
        },
      },
    });
  });

  it("appends the markdown footer for GitHub Enterprise Server API paths", async () => {
    const request = createGitHubRequest({
      baseUrl: "https://ghe.example.com",
      pathname: "/api/v3/repos/mistlehq/mistle/issues/123/comments",
      body: {
        body: "GHES issue comment",
      },
    });

    const result = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    expect(JSON.parse(new TextDecoder().decode(result.body))).toEqual({
      body: `GHES issue comment\n\n---\n[🔗 View session](${SessionUrl})`,
    });
  });

  it("does not append the markdown footer twice", async () => {
    const request = createGitHubRequest({
      pathname: "/repos/mistlehq/mistle/issues/123/comments",
      body: {
        body: `Issue comment\n\n---\n[🔗 View session](${SessionUrl})`,
      },
    });

    const result = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    expect(JSON.parse(new TextDecoder().decode(result.body))).toEqual({
      body: `Issue comment\n\n---\n[🔗 View session](${SessionUrl})`,
    });
  });

  it("does not mutate non-target GitHub API routes", async () => {
    const request = createGitHubRequest({
      method: "PATCH",
      pathname: "/repos/mistlehq/mistle/issues/123",
      body: {
        body: "Issue body",
      },
    });

    const result = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    expect(JSON.parse(new TextDecoder().decode(result.body))).toEqual({
      body: "Issue body",
    });
  });

  it("does not mutate unrelated GraphQL mutations", async () => {
    const request = createGitHubRequest({
      pathname: "/graphql",
      body: {
        query:
          "mutation CreateIssue($input:CreateIssueInput!){createIssue(input: $input){issue{id}}}",
        variables: {
          input: {
            repositoryId: "R_kgDOExample",
            title: "Issue title",
            body: "Issue body",
          },
        },
      },
    });

    const result = await AppendSessionLinkToGitHubMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    expect(JSON.parse(new TextDecoder().decode(result.body))).toEqual({
      query:
        "mutation CreateIssue($input:CreateIssueInput!){createIssue(input: $input){issue{id}}}",
      variables: {
        input: {
          repositoryId: "R_kgDOExample",
          title: "Issue title",
          body: "Issue body",
        },
      },
    });
  });
});
