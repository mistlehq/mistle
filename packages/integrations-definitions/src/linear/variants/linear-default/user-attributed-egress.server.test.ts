import { describe, expect, it } from "vitest";

import { LinearFamilyId } from "./auth.js";
import {
  resolveLinearUserAttributedEgressCredentialResolver,
  shouldUseLinearLinkedPrincipalCredential,
} from "./user-attributed-egress.server.js";

const DefaultCredentialResolver = {
  kind: "integration_connection" as const,
  connectionId: "icn_123",
  secretType: "api_key",
  slotKey: "linear.linear-default.api-key.api-key",
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

describe("shouldUseLinearLinkedPrincipalCredential", () => {
  it("matches Linear GraphQL requests", () => {
    expect(
      shouldUseLinearLinkedPrincipalCredential({
        request: {
          method: "POST",
          url: new URL("https://api.linear.app/graphql"),
        },
      }),
    ).toBe(true);
  });

  it("matches Linear GraphQL requests with a trailing slash", () => {
    expect(
      shouldUseLinearLinkedPrincipalCredential({
        request: {
          method: "POST",
          url: new URL("https://api.linear.app/graphql/"),
        },
      }),
    ).toBe(true);
  });

  it("matches Linear MCP requests", () => {
    expect(
      shouldUseLinearLinkedPrincipalCredential({
        request: {
          method: "POST",
          url: new URL("https://mcp.linear.app/mcp"),
        },
      }),
    ).toBe(true);
  });

  it("matches Linear MCP requests with a trailing slash", () => {
    expect(
      shouldUseLinearLinkedPrincipalCredential({
        request: {
          method: "POST",
          url: new URL("https://mcp.linear.app/mcp/"),
        },
      }),
    ).toBe(true);
  });

  it("does not match unrelated Linear requests", () => {
    expect(
      shouldUseLinearLinkedPrincipalCredential({
        request: {
          method: "GET",
          url: new URL("https://api.linear.app/graphql"),
        },
      }),
    ).toBe(false);
  });

  it("does not match path prefixes without a slash boundary", () => {
    expect(
      shouldUseLinearLinkedPrincipalCredential({
        request: {
          method: "POST",
          url: new URL("https://api.linear.app/graphql-admin"),
        },
      }),
    ).toBe(false);
  });
});

describe("resolveLinearUserAttributedEgressCredentialResolver", () => {
  it("returns a linked-principal resolver for Linear GraphQL requests", () => {
    expect(
      resolveLinearUserAttributedEgressCredentialResolver(
        createSelectionInput("https://api.linear.app/graphql", "POST"),
      ),
    ).toEqual({
      kind: "linked_principal",
      providerFamily: LinearFamilyId,
      credentialKind: "linear_oauth_user_token",
      actingUserRequired: true,
      resolutionMode: "preferred",
    });
  });

  it("preserves the default resolver for unrelated requests", () => {
    expect(
      resolveLinearUserAttributedEgressCredentialResolver(
        createSelectionInput("https://api.linear.app/graphql", "GET"),
      ),
    ).toEqual(DefaultCredentialResolver);
  });

  it("preserves non-integration default resolvers", () => {
    expect(
      resolveLinearUserAttributedEgressCredentialResolver({
        ...createSelectionInput("https://api.linear.app/graphql", "POST"),
        defaultCredentialResolver: {
          kind: "linked_principal",
          providerFamily: LinearFamilyId,
          credentialKind: "linear_oauth_user_token",
          actingUserRequired: true,
          resolutionMode: "required",
        },
      }),
    ).toEqual({
      kind: "linked_principal",
      providerFamily: LinearFamilyId,
      credentialKind: "linear_oauth_user_token",
      actingUserRequired: true,
      resolutionMode: "required",
    });
  });
});
