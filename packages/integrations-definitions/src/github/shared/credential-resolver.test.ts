import {
  IntegrationConnectionMethodIds,
  type IntegrationCredentialResolverInput,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  createGitHubInstallationAuthInput,
  resolveGitHubAppCredentialContext,
  resolveGitHubInstallationRepositoryNames,
} from "./credential-resolver.server.js";

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
      },
      secrets: {},
    },
    connection: {
      id: "icn_test",
      status: "active",
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
        installation_id: "12345",
      },
      secrets: {
        appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
      },
    },
    secretType: "github_app_installation_token",
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
    ...(overrides?.slotKey === undefined ? {} : { slotKey: overrides.slotKey }),
    binding,
  };
}

describe("github credential resolver helpers", () => {
  it("deduplicates, strips owners, and sorts binding repositories for installation token narrowing", () => {
    expect(resolveGitHubInstallationRepositoryNames(createResolverInput())).toEqual([
      "repo-a",
      "repo-b",
    ]);
  });

  it("omits installation token narrowing when binding context is absent", () => {
    const resolverInput = createResolverInput();
    delete resolverInput.binding;

    expect(resolveGitHubInstallationRepositoryNames(resolverInput)).toBeUndefined();
  });

  it("includes repository names in the installation auth request input", () => {
    expect(
      createGitHubInstallationAuthInput({
        apiBaseUrl: "https://api.github.com",
        appId: "123",
        appPrivateKeyPem: "pem",
        installationId: 12345,
        repositoryNames: ["repo-a", "repo-b"],
      }),
    ).toEqual({
      type: "installation",
      installationId: 12345,
      repositoryNames: ["repo-a", "repo-b"],
    });
  });

  it("omits repository names from the installation auth request input when binding context is absent", () => {
    expect(
      createGitHubInstallationAuthInput({
        apiBaseUrl: "https://api.github.com",
        appId: "123",
        appPrivateKeyPem: "pem",
        installationId: 12345,
      }),
    ).toEqual({
      type: "installation",
      installationId: 12345,
    });
  });

  it("resolves app id and private key from the connection context", () => {
    expect(resolveGitHubAppCredentialContext(createResolverInput())).toMatchObject({
      apiBaseUrl: "https://api.github.com",
      appId: "123",
      appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
      installationId: 12345,
      repositoryNames: ["repo-a", "repo-b"],
    });
  });

  it("fails fast when the connection secret is missing the app private key", () => {
    expect(() =>
      resolveGitHubAppCredentialContext(
        createResolverInput({
          connection: {
            id: "icn_test",
            status: "active",
            config: {
              connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
              app_id: "123",
              app_slug: "mistle-github-app",
              client_id: "Iv1.client123",
              installation_id: "12345",
            },
            secrets: {},
          },
        }),
      ),
    ).toThrow("GitHub app installation resolver requires connection secret `appPrivateKeyPem`.");
  });
});
