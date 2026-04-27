import { describe, expect, it } from "vitest";

import { buildGitHubAppManifest, buildGitHubAppManifestSubmissionUrl } from "./manifest-builder.js";

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
      redirect_url: "https://control-plane.example.com/p/integration/callbacks/github-app-manifest",
      callback_urls: ["https://control-plane.example.com/p/identity-linking/callbacks/github"],
      setup_url:
        "https://control-plane.example.com/p/integration/callbacks/github-app-installation",
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
