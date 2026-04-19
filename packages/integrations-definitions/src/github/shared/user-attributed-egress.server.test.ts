import { describe, expect, it } from "vitest";

import { GitHubFamilyId } from "./constants.js";
import {
  resolveGitHubUserAttributedEgressCredentialResolver,
  shouldUseGitHubLinkedPrincipalCredential,
} from "./user-attributed-egress.server.js";

const DefaultCredentialResolver = {
  kind: "integration_connection" as const,
  connectionId: "icn_123",
  secretType: "github_app_installation_token",
  resolverKey: "github_app_installation_token",
};

function createSelectionInput(url: string, method: string) {
  return {
    organizationId: "org_123",
    actingUserId: "usr_123",
    request: {
      method,
      url: new URL(url),
      headers: new Headers(),
      body: undefined,
    },
    defaultCredentialResolver: DefaultCredentialResolver,
  };
}

function encodeRequestBodyJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("shouldUseGitHubLinkedPrincipalCredential", () => {
  it("matches pull request creation requests", () => {
    expect(
      shouldUseGitHubLinkedPrincipalCredential({
        request: {
          method: "POST",
          url: new URL("https://api.github.com/repos/mistlehq/mistle/pulls"),
        },
      }),
    ).toBe(true);
  });

  it("matches pull request update requests", () => {
    expect(
      shouldUseGitHubLinkedPrincipalCredential({
        request: {
          method: "PATCH",
          url: new URL("https://api.github.com/repos/mistlehq/mistle/pulls/42"),
        },
      }),
    ).toBe(true);
  });

  it("matches git receive-pack discovery requests", () => {
    expect(
      shouldUseGitHubLinkedPrincipalCredential({
        request: {
          method: "GET",
          url: new URL("https://github.com/mistlehq/mistle.git/info/refs?service=git-receive-pack"),
        },
      }),
    ).toBe(true);
  });

  it("matches git receive-pack requests", () => {
    expect(
      shouldUseGitHubLinkedPrincipalCredential({
        request: {
          method: "POST",
          url: new URL("https://github.com/mistlehq/mistle.git/git-receive-pack"),
        },
      }),
    ).toBe(true);
  });

  it("matches graphql create pull request mutations", () => {
    expect(
      shouldUseGitHubLinkedPrincipalCredential({
        request: {
          method: "POST",
          url: new URL("https://api.github.com/graphql"),
          body: encodeRequestBodyJson({
            operationName: "CreatePullRequest",
            query:
              "mutation CreatePullRequest($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { id } } }",
          }),
        },
      }),
    ).toBe(true);
  });

  it("does not match unrelated github requests", () => {
    expect(
      shouldUseGitHubLinkedPrincipalCredential({
        request: {
          method: "GET",
          url: new URL("https://api.github.com/repos/mistlehq/mistle"),
        },
      }),
    ).toBe(false);
  });
});

describe("resolveGitHubUserAttributedEgressCredentialResolver", () => {
  it("returns a linked-principal resolver for user-attributed github operations", () => {
    expect(
      resolveGitHubUserAttributedEgressCredentialResolver(
        createSelectionInput("https://api.github.com/repos/mistlehq/mistle/pulls", "POST"),
      ),
    ).toEqual({
      kind: "linked_principal",
      providerFamily: GitHubFamilyId,
      credentialKind: "github_app_user_access_token",
      actingUserRequired: true,
      resolutionMode: "preferred",
    });
  });

  it("returns a linked-principal resolver for graphql pull request mutations", () => {
    expect(
      resolveGitHubUserAttributedEgressCredentialResolver({
        ...createSelectionInput("https://api.github.com/graphql", "POST"),
        request: {
          method: "POST",
          url: new URL("https://api.github.com/graphql"),
          headers: new Headers(),
          body: encodeRequestBodyJson({
            operationName: "CreatePullRequest",
            query:
              "mutation CreatePullRequest($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { id } } }",
          }),
        },
      }),
    ).toEqual({
      kind: "linked_principal",
      providerFamily: GitHubFamilyId,
      credentialKind: "github_app_user_access_token",
      actingUserRequired: true,
      resolutionMode: "preferred",
    });
  });

  it("preserves the default resolver for unrelated requests", () => {
    expect(
      resolveGitHubUserAttributedEgressCredentialResolver(
        createSelectionInput("https://api.github.com/repos/mistlehq/mistle", "GET"),
      ),
    ).toEqual(DefaultCredentialResolver);
  });

  it("preserves non-integration default resolvers", () => {
    expect(
      resolveGitHubUserAttributedEgressCredentialResolver({
        ...createSelectionInput("https://api.github.com/repos/mistlehq/mistle/pulls", "POST"),
        defaultCredentialResolver: {
          kind: "linked_principal",
          providerFamily: GitHubFamilyId,
          credentialKind: "github_app_user_access_token",
          actingUserRequired: true,
          resolutionMode: "required",
        },
      }),
    ).toEqual({
      kind: "linked_principal",
      providerFamily: GitHubFamilyId,
      credentialKind: "github_app_user_access_token",
      actingUserRequired: true,
      resolutionMode: "required",
    });
  });
});
