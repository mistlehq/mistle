import { IntegrationWebhookTriggerCapabilitiesProviderMetadataKey } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildConvertedGitHubAppConnectionConfig,
  buildConvertedGitHubAppConnectionSecrets,
  buildGitHubAppManifest,
  buildGitHubAppManifestConversionUrl,
  buildGitHubAppManifestDraft,
  buildGitHubAppManifestSubmissionUrl,
  buildGitHubAppManifestWebhookTriggerCapabilitiesProviderMetadata,
  buildGitHubAppInstallationUrl,
  GitHubAppManifestConversionMissingClientSecretError,
  GitHubAppManifestOwnerSchema,
  GitHubAppManifestTemplate,
  parseGitHubAppManifestConversionResponse,
} from "./app-manifest.js";

function createGitHubAppManifestConversionFixture(input?: { clientSecret?: string }) {
  return parseGitHubAppManifestConversionResponse({
    id: "123",
    slug: "mistle-github-app",
    client_id: "Iv1.manifestclientid",
    ...(input?.clientSecret === undefined ? {} : { client_secret: input.clientSecret }),
    pem: "private-key",
    webhook_secret: "webhook-secret",
  });
}

describe("GitHubAppManifestTemplate", () => {
  it("includes the default GitHub App permissions and event subscriptions", () => {
    expect(GitHubAppManifestTemplate).toMatchObject({
      name: "Mistle GitHub App",
      hook_attributes: {
        active: true,
        url: "https://mistle.example.com/api/integrations/github/webhook",
      },
      redirect_url: "https://mistle.example.com/api/integrations/github/manifest/callback",
      callback_urls: ["https://mistle.example.com/api/integrations/github/install/callback"],
      setup_url: "https://mistle.example.com/api/integrations/github/setup",
      public: false,
      default_events: [
        "issues",
        "issue_comment",
        "pull_request",
        "pull_request_review",
        "pull_request_review_comment",
        "check_run",
        "check_suite",
      ],
      default_permissions: {
        checks: "write",
        contents: "write",
        issues: "write",
        metadata: "read",
        pull_requests: "write",
      },
    });
  });
});

describe("buildGitHubAppManifestWebhookTriggerCapabilitiesProviderMetadata", () => {
  it("maps GitHub App manifest event subscriptions and permissions into webhook trigger capabilities", () => {
    expect(
      buildGitHubAppManifestWebhookTriggerCapabilitiesProviderMetadata({
        default_events: ["issues", "pull_request"],
        default_permissions: {
          issues: "read",
          pull_requests: "write",
        },
      }),
    ).toEqual({
      [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
        events: ["issues", "pull_request"],
        permissions: [
          {
            permission: "issues",
            access: "read",
          },
          {
            permission: "pull_requests",
            access: "write",
          },
          {
            permission: "pull_requests",
            access: "read",
          },
        ],
      },
    });
  });
});

describe("parseGitHubAppManifestConversionResponse", () => {
  it("accepts GitHub manifest conversion responses with numeric ids", () => {
    const conversion = parseGitHubAppManifestConversionResponse({
      id: 123,
      slug: "mistle-github-app",
      client_id: "Iv1.manifestclientid",
      client_secret: "manifest-client-secret",
      pem: "-----BEGIN PRIVATE KEY-----\nmanifest\n-----END PRIVATE KEY-----",
      webhook_secret: "manifest-webhook-secret",
      ignored_extra_field: true,
    });

    expect(conversion).toEqual({
      id: 123,
      slug: "mistle-github-app",
      client_id: "Iv1.manifestclientid",
      client_secret: "manifest-client-secret",
      pem: "-----BEGIN PRIVATE KEY-----\nmanifest\n-----END PRIVATE KEY-----",
      webhook_secret: "manifest-webhook-secret",
      ignored_extra_field: true,
    });
  });

  it("rejects conversion responses missing required credential material", () => {
    let thrownError: unknown = null;

    try {
      parseGitHubAppManifestConversionResponse({
        id: 123,
        slug: "mistle-github-app",
        client_id: "Iv1.manifestclientid",
        webhook_secret: "manifest-webhook-secret",
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(z.ZodError);
  });
});

describe("GitHubAppManifestOwnerSchema", () => {
  it("accepts personal GitHub App owners", () => {
    expect(
      GitHubAppManifestOwnerSchema.parse({
        kind: "personal",
      }),
    ).toEqual({
      kind: "personal",
    });
  });

  it("accepts and trims organization GitHub App owners", () => {
    expect(
      GitHubAppManifestOwnerSchema.parse({
        kind: "organization",
        organizationSlug: " Mistle-Org ",
      }),
    ).toEqual({
      kind: "organization",
      organizationSlug: "Mistle-Org",
    });
  });

  it("rejects invalid organization slugs", () => {
    expect(() =>
      GitHubAppManifestOwnerSchema.parse({
        kind: "organization",
        organizationSlug: "-mistle-org",
      }),
    ).toThrow("Invalid string");
  });
});

describe("buildConvertedGitHubAppConnectionConfig", () => {
  it("maps conversion metadata into GitHub App installation config", () => {
    const conversion = createGitHubAppManifestConversionFixture();

    expect(buildConvertedGitHubAppConnectionConfig({ conversion })).toEqual({
      connection_method: "github-app-installation",
      app_id: "123",
      app_slug: "mistle-github-app",
      client_id: "Iv1.manifestclientid",
    });
  });
});

describe("buildConvertedGitHubAppConnectionSecrets", () => {
  it("maps required GitHub credential material into connection secrets", () => {
    const conversion = createGitHubAppManifestConversionFixture({
      clientSecret: "manifest-client-secret",
    });

    expect(
      buildConvertedGitHubAppConnectionSecrets({
        conversion,
        supportsClientSecret: true,
      }),
    ).toEqual({
      appPrivateKeyPem: "private-key",
      webhookSecret: "webhook-secret",
      clientSecret: "manifest-client-secret",
    });
  });

  it("omits client secret when the target method does not support it", () => {
    const conversion = createGitHubAppManifestConversionFixture();

    expect(
      buildConvertedGitHubAppConnectionSecrets({
        conversion,
        supportsClientSecret: false,
      }),
    ).toEqual({
      appPrivateKeyPem: "private-key",
      webhookSecret: "webhook-secret",
    });
  });

  it("fails fast when a supported client secret is missing from the conversion", () => {
    const conversion = createGitHubAppManifestConversionFixture();

    expect(() =>
      buildConvertedGitHubAppConnectionSecrets({
        conversion,
        supportsClientSecret: true,
      }),
    ).toThrow(GitHubAppManifestConversionMissingClientSecretError);
  });
});

describe("buildGitHubAppManifest", () => {
  it("injects Mistle GitHub manifest callback URLs and webhook settings", () => {
    const manifest = buildGitHubAppManifest({
      controlPlaneBaseUrl: "https://control-plane.example.com",
      webhookCallbackUrl:
        "https://control-plane.example.com/p/integration/webhooks/github-default/eps_123",
      manifest: {
        name: "Mistle",
        public: false,
        hook_attributes: {
          active: false,
          url: "https://example.com/old-webhook",
        },
        callback_urls: ["https://example.com/old-callback"],
      },
    });

    expect(manifest).toEqual({
      name: "Mistle",
      public: false,
      hook_attributes: {
        active: true,
        url: "https://control-plane.example.com/p/integration/webhooks/github-default/eps_123",
      },
      redirect_url:
        "https://control-plane.example.com/p/integration/callbacks/setup/github-app-manifest",
      callback_urls: ["https://control-plane.example.com/p/identity-linking/callbacks/github"],
      setup_url:
        "https://control-plane.example.com/p/integration/callbacks/setup/github-app-installation",
    });
  });
});

describe("buildGitHubAppManifestDraft", () => {
  it("builds the default GitHub app manifest with real Mistle callback URLs", () => {
    const manifest = buildGitHubAppManifestDraft({
      controlPlaneBaseUrl: "https://control-plane.example.com",
      webhookCallbackUrl:
        "https://control-plane.example.com/p/integration/webhooks/github-default/eps_123",
    });

    expect(manifest).toMatchObject({
      name: "Mistle GitHub App",
      hook_attributes: {
        active: true,
        url: "https://control-plane.example.com/p/integration/webhooks/github-default/eps_123",
      },
      redirect_url:
        "https://control-plane.example.com/p/integration/callbacks/setup/github-app-manifest",
      callback_urls: ["https://control-plane.example.com/p/identity-linking/callbacks/github"],
      setup_url:
        "https://control-plane.example.com/p/integration/callbacks/setup/github-app-installation",
    });
    expect(manifest).not.toMatchObject({
      hook_attributes: {
        url: "https://mistle.example.com/api/integrations/github/webhook",
      },
      redirect_url: "https://mistle.example.com/api/integrations/github/manifest/callback",
      callback_urls: ["https://mistle.example.com/api/integrations/github/install/callback"],
      setup_url: "https://mistle.example.com/api/integrations/github/setup",
    });
  });
});

describe("buildGitHubAppManifestSubmissionUrl", () => {
  it("builds the personal account manifest creation URL", () => {
    expect(
      buildGitHubAppManifestSubmissionUrl({
        owner: { kind: "personal" },
        state: "state_123",
        webBaseUrl: "https://github.example.com",
      }),
    ).toBe("https://github.example.com/settings/apps/new?state=state_123");
  });

  it("builds the organization manifest creation URL", () => {
    expect(
      buildGitHubAppManifestSubmissionUrl({
        owner: {
          kind: "organization",
          organizationSlug: "Mistle-Org",
        },
        state: "state_123",
        webBaseUrl: "https://github.example.com",
      }),
    ).toBe("https://github.example.com/organizations/Mistle-Org/settings/apps/new?state=state_123");
  });
});

describe("buildGitHubAppManifestConversionUrl", () => {
  it("builds the manifest conversion endpoint URL", () => {
    expect(
      buildGitHubAppManifestConversionUrl({
        apiBaseUrl: "https://api.github.example.com",
        code: "code/with spaces",
      }),
    ).toBe("https://api.github.example.com/app-manifests/code%2Fwith%20spaces/conversions");
  });
});

describe("buildGitHubAppInstallationUrl", () => {
  it("builds the GitHub Cloud app installation URL", () => {
    expect(
      buildGitHubAppInstallationUrl({
        appSlug: "mistle-github-app",
        state: "state_123",
        variantId: "github-cloud",
        webBaseUrl: "https://github.example.com",
      }),
    ).toBe(
      "https://github.example.com/apps/mistle-github-app/installations/select_target?state=state_123",
    );
  });

  it("builds the GitHub Enterprise Server app installation URL", () => {
    expect(
      buildGitHubAppInstallationUrl({
        appSlug: "mistle-github-app",
        state: "state_123",
        variantId: "github-enterprise-server",
        webBaseUrl: "https://github.example.com",
      }),
    ).toBe(
      "https://github.example.com/github-apps/mistle-github-app/installations/select_target?state=state_123",
    );
  });

  it("preserves web base path prefixes in app installation URLs", () => {
    expect(
      buildGitHubAppInstallationUrl({
        appSlug: "mistle-github-app",
        state: "state_123",
        variantId: "github-cloud",
        webBaseUrl: "https://proxy.example.com/github",
      }),
    ).toBe(
      "https://proxy.example.com/github/apps/mistle-github-app/installations/select_target?state=state_123",
    );
  });
});
