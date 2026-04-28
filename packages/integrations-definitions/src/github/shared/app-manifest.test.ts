import { describe, expect, it } from "vitest";

import {
  GitHubAppManifestTemplate,
  buildGitHubAppManifest,
  buildGitHubAppManifestSubmissionUrl,
} from "./app-manifest.js";

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
