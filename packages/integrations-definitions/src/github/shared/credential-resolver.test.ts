import {
  IntegrationSupportedAuthSchemes,
  type IntegrationCredentialResolverInput,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  createGitHubInstallationAuthInput,
  resolveGitHubInstallationRepositoryNames,
} from "./credential-resolver.js";

function createResolverInput(
  overrides?: Omit<Partial<IntegrationCredentialResolverInput>, "binding"> & {
    binding?: IntegrationCredentialResolverInput["binding"];
  },
): IntegrationCredentialResolverInput {
  const input: IntegrationCredentialResolverInput = {
    organizationId: "org_test",
    targetKey: "github-cloud",
    connectionId: "icn_test",
    target: {
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        apiBaseUrl: "https://api.github.com",
        appId: "123",
      },
      secrets: {
        appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
      },
    },
    connection: {
      id: "icn_test",
      status: "active",
      config: {
        auth_scheme: IntegrationSupportedAuthSchemes.OAUTH,
        installation_id: "12345",
      },
    },
    secretType: "oauth_access_token",
  };

  const binding = overrides?.binding ?? {
    id: "ibd_test",
    kind: "git" as const,
    config: {
      repositories: ["acme/repo-b", "acme/repo-a", "acme/repo-a"],
    },
  };

  return {
    organizationId: overrides?.organizationId ?? input.organizationId,
    targetKey: overrides?.targetKey ?? input.targetKey,
    connectionId: overrides?.connectionId ?? input.connectionId,
    target: overrides?.target ?? input.target,
    connection: overrides?.connection ?? input.connection,
    secretType: overrides?.secretType ?? input.secretType,
    ...(overrides?.purpose === undefined ? {} : { purpose: overrides.purpose }),
    binding,
  };
}

describe("github credential resolver helpers", () => {
  it("deduplicates and sorts binding repositories for installation token narrowing", () => {
    expect(resolveGitHubInstallationRepositoryNames(createResolverInput())).toEqual([
      "acme/repo-a",
      "acme/repo-b",
    ]);
  });

  it("requires binding context to derive installation token narrowing", () => {
    const resolverInput = createResolverInput();
    delete resolverInput.binding;

    expect(() => resolveGitHubInstallationRepositoryNames(resolverInput)).toThrowError(
      "GitHub app installation resolver requires binding context.",
    );
  });

  it("includes repository names in the installation auth request input", () => {
    expect(
      createGitHubInstallationAuthInput({
        apiBaseUrl: "https://api.github.com",
        appId: "123",
        appPrivateKeyPem: "pem",
        installationId: 12345,
        repositoryNames: ["acme/repo-a", "acme/repo-b"],
      }),
    ).toEqual({
      type: "installation",
      installationId: 12345,
      repositoryNames: ["acme/repo-a", "acme/repo-b"],
    });
  });
});
