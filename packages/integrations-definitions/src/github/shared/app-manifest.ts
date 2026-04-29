import { buildUrlWithPath } from "@mistle/http";
import {
  IntegrationConnectionMethodIds,
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
} from "@mistle/integrations-core";
import { z } from "zod";

const GitHubAppManifestConversionResponseSchema = z
  .object({
    id: z.union([z.string().min(1), z.number().int().nonnegative()]),
    slug: z.string().min(1),
    client_id: z.string().min(1),
    client_secret: z.string().min(1).optional(),
    pem: z.string().min(1),
    webhook_secret: z.string().min(1),
  })
  .loose();

const GitHubAppManifestWebhookTriggerCapabilitiesSchema = z
  .object({
    default_events: z.array(z.string().min(1)).min(1),
    default_permissions: z.record(z.string().min(1), z.string().min(1)),
  })
  .loose();

export const GitHubAppManifestOwnerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("personal"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("organization"),
      organizationSlug: z
        .string()
        .trim()
        .min(1)
        .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/),
    })
    .strict(),
]);

export type GitHubAppManifestOwner = z.output<typeof GitHubAppManifestOwnerSchema>;

export type GitHubAppManifestConversion = z.output<
  typeof GitHubAppManifestConversionResponseSchema
>;

export class GitHubAppManifestConversionMissingClientSecretError extends Error {
  constructor() {
    super("GitHub App manifest conversion response is missing `client_secret`.");
    this.name = "GitHubAppManifestConversionMissingClientSecretError";
  }
}

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
  request_oauth_on_install: false,
  setup_on_update: true,
} satisfies Record<string, unknown>;

export function parseGitHubAppManifestConversionResponse(
  value: unknown,
): GitHubAppManifestConversion {
  return GitHubAppManifestConversionResponseSchema.parse(value);
}

export function buildConvertedGitHubAppConnectionConfig(input: {
  conversion: GitHubAppManifestConversion;
}): Record<string, string> {
  return {
    connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    app_id: input.conversion.id.toString(),
    app_slug: input.conversion.slug,
    client_id: input.conversion.client_id,
  };
}

export function buildConvertedGitHubAppConnectionSecrets(input: {
  conversion: GitHubAppManifestConversion;
  supportsClientSecret: boolean;
}): Record<string, string> {
  if (!input.supportsClientSecret) {
    return {
      appPrivateKeyPem: input.conversion.pem,
      webhookSecret: input.conversion.webhook_secret,
    };
  }

  const clientSecret = input.conversion.client_secret;
  if (clientSecret === undefined) {
    throw new GitHubAppManifestConversionMissingClientSecretError();
  }

  return {
    appPrivateKeyPem: input.conversion.pem,
    webhookSecret: input.conversion.webhook_secret,
    clientSecret,
  };
}

export function buildGitHubAppManifestWebhookTriggerCapabilitiesProviderMetadata(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  const parsedManifest = GitHubAppManifestWebhookTriggerCapabilitiesSchema.parse(manifest);

  return {
    [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
      events: parsedManifest.default_events,
      permissions: Object.entries(parsedManifest.default_permissions).flatMap(
        ([permission, access]) =>
          access === "write"
            ? [
                { permission, access: "write" },
                { permission, access: "read" },
              ]
            : [{ permission, access }],
      ),
    },
  };
}

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

export function buildGitHubAppManifestConversionUrl(input: {
  apiBaseUrl: string;
  code: string;
}): string {
  return buildUrlWithPath(
    input.apiBaseUrl,
    `/app-manifests/${encodeURIComponent(input.code)}/conversions`,
  );
}

export function buildGitHubAppInstallationUrl(input: {
  appSlug: string;
  state: string;
  variantId: string;
  webBaseUrl: string;
}): string {
  const installationPath =
    input.variantId === "github-enterprise-server"
      ? `/github-apps/${input.appSlug}/installations/select_target`
      : `/apps/${input.appSlug}/installations/select_target`;
  const installUrl = new URL(buildUrlWithPath(input.webBaseUrl, installationPath));
  installUrl.searchParams.set("state", input.state);
  return installUrl.toString();
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
      "/p/integration/callbacks/setup/github-app-manifest",
    ),
    callback_urls: [
      buildUrlWithPath(input.controlPlaneBaseUrl, "/p/identity-linking/callbacks/github"),
    ],
    setup_url: buildUrlWithPath(
      input.controlPlaneBaseUrl,
      "/p/integration/callbacks/setup/github-app-installation",
    ),
  };
}

export function buildGitHubAppManifestDraft(input: {
  controlPlaneBaseUrl: string;
  webhookCallbackUrl: string;
}): Record<string, unknown> {
  return buildGitHubAppManifest({
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    manifest: GitHubAppManifestTemplate,
    webhookCallbackUrl: input.webhookCallbackUrl,
  });
}
