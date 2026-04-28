import { buildUrlWithPath } from "@mistle/http";

export type GitHubAppManifestOwner =
  | {
      kind: "personal";
    }
  | {
      kind: "organization";
      organizationSlug: string;
    };

export const GitHubAppManifestTemplate = {
  name: "Mistle GitHub App",
  url: "https://github.com/mistlehq/mistle",
  description: "Used in Mistle for sandbox agents",
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
  request_oauth_on_install: false,
  setup_on_update: true,
} as const;

export function buildGitHubAppManifestSubmissionUrl(input: {
  owner: GitHubAppManifestOwner;
  state: string;
  webBaseUrl: string;
}): string {
  const path =
    input.owner.kind === "personal"
      ? "/settings/apps/new"
      : `/organizations/${encodeURIComponent(input.owner.organizationSlug)}/settings/apps/new`;
  const submissionUrl = new URL(buildUrlWithPath(input.webBaseUrl, path));
  submissionUrl.searchParams.set("state", input.state);
  return submissionUrl.toString();
}

export function buildGitHubAppManifest(input: {
  controlPlaneBaseUrl: string;
  manifest: Record<string, unknown>;
  webhookCallbackUrl: string;
}): Record<string, unknown> {
  return {
    ...input.manifest,
    hook_attributes: {
      active: true,
      url: input.webhookCallbackUrl,
    },
    redirect_url: buildUrlWithPath(
      input.controlPlaneBaseUrl,
      "/p/integration/callbacks/github-app-manifest",
    ),
    callback_urls: [
      buildUrlWithPath(input.controlPlaneBaseUrl, "/p/identity-linking/callbacks/github"),
    ],
    setup_url: buildUrlWithPath(
      input.controlPlaneBaseUrl,
      "/p/integration/callbacks/github-app-installation",
    ),
  };
}
