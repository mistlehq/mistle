import { buildUrlWithPath } from "@mistle/http";

export type GitHubAppManifestOwner =
  | {
      kind: "personal";
    }
  | {
      kind: "organization";
      organizationSlug: string;
    };

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
  manifest: Record<string, unknown>;
  controlPlaneBaseUrl: string;
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
