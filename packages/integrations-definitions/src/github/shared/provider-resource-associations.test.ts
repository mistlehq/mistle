import { AssociatedProviderResourceKinds } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { observeGitHubRoutableResourceFromEgressResponse } from "./provider-resource-associations.js";

describe("observeGitHubRoutableResourceFromEgressResponse", () => {
  it("recognizes successful GitHub pull request creation responses", () => {
    expect(
      observeGitHubRoutableResourceFromEgressResponse({
        method: "POST",
        path: "/repos/mistlehq/mistle/pulls",
        status: 201,
        responseBody: {
          id: 123456,
          number: 42,
          base: {
            repo: {
              full_name: "mistlehq/mistle",
            },
          },
        },
      }),
    ).toEqual({
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "mistlehq/mistle#42",
    });
  });

  it("recognizes GitHub Enterprise REST API-prefixed pull request creation responses", () => {
    expect(
      observeGitHubRoutableResourceFromEgressResponse({
        method: "POST",
        path: "/api/v3/repos/mistlehq/mistle/pulls",
        status: 201,
        responseBody: {
          id: 234567,
          number: 43,
          base: {
            repo: {
              full_name: "mistlehq/mistle",
            },
          },
        },
      }),
    ).toEqual({
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "mistlehq/mistle#43",
    });
  });

  it("recognizes GraphQL createPullRequest responses with a pull request repository and number", () => {
    expect(
      observeGitHubRoutableResourceFromEgressResponse({
        method: "POST",
        path: "/api/graphql",
        requestBody: encodeJson({
          operationName: "CreatePullRequest",
          query:
            "mutation CreatePullRequest($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { number repository { nameWithOwner } } } }",
        }),
        status: 200,
        responseBody: {
          data: {
            createPullRequest: {
              pullRequest: {
                databaseId: 345678,
                number: 44,
                repository: {
                  nameWithOwner: "mistlehq/mistle",
                },
              },
            },
          },
        },
      }),
    ).toEqual({
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "mistlehq/mistle#44",
    });
  });

  it("ignores non-PR-create requests and unsuccessful responses", () => {
    expect(
      observeGitHubRoutableResourceFromEgressResponse({
        method: "GET",
        path: "/repos/mistlehq/mistle/pulls",
        status: 200,
        responseBody: { id: 123456 },
      }),
    ).toBeNull();
    expect(
      observeGitHubRoutableResourceFromEgressResponse({
        method: "POST",
        path: "/repos/mistlehq/mistle/issues",
        status: 201,
        responseBody: { id: 123456 },
      }),
    ).toBeNull();
    expect(
      observeGitHubRoutableResourceFromEgressResponse({
        method: "POST",
        path: "/repos/mistlehq/mistle/pulls",
        status: 422,
        responseBody: { id: 123456 },
      }),
    ).toBeNull();
  });

  it("ignores malformed GitHub pull request creation responses", () => {
    expect(
      observeGitHubRoutableResourceFromEgressResponse({
        method: "POST",
        path: "/repos/mistlehq/mistle/pulls",
        status: 201,
        responseBody: {
          number: 42,
        },
      }),
    ).toBeNull();
    expect(
      observeGitHubRoutableResourceFromEgressResponse({
        method: "POST",
        path: "/graphql",
        requestBody: encodeJson({
          operationName: "CreatePullRequest",
          query:
            "mutation CreatePullRequest($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { id } } }",
        }),
        status: 200,
        responseBody: {
          data: {
            createPullRequest: {
              pullRequest: {
                id: "opaque-node-id",
              },
            },
          },
        },
      }),
    ).toBeNull();
  });
});

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
