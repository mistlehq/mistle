import { z } from "zod";

export const AtlassianConnectionMethodIds = {
  PERSONAL_API_TOKEN: "atlassian-personal-api-token",
  SERVICE_ACCOUNT_API_TOKEN: "atlassian-service-account-api-token",
  SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS: "atlassian-service-account-oauth-client-credentials",
} as const;

export const AtlassianCredentialSecretTypes = {
  API_KEY: "api_key",
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
  OAUTH2_CLIENT_SECRET: "oauth2_client_secret",
} as const;

export function normalizeAtlassianBaseUrl(input: string): string {
  const parsedUrl = new URL(input);
  const pathnameWithoutTrailingSlash = parsedUrl.pathname.endsWith("/")
    ? parsedUrl.pathname.slice(0, -1)
    : parsedUrl.pathname;
  const normalizedPathname =
    pathnameWithoutTrailingSlash.length === 0 ? "/" : pathnameWithoutTrailingSlash;

  parsedUrl.pathname = normalizedPathname;
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return normalizedPathname === "/" ? parsedUrl.origin : parsedUrl.toString();
}

function tryParseAtlassianSiteUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

const AtlassianSiteUrlSchema = z.url().superRefine((value, ctx) => {
  const parsedUrl = tryParseAtlassianSiteUrl(value);
  if (parsedUrl === null) {
    return;
  }

  if (parsedUrl.protocol !== "https:") {
    ctx.addIssue({
      code: "custom",
      message: "Atlassian site URLs must use https.",
    });
  }

  if (!parsedUrl.hostname.endsWith(".atlassian.net")) {
    ctx.addIssue({
      code: "custom",
      message: "Atlassian site URLs must use an *.atlassian.net hostname.",
    });
  }

  if (parsedUrl.pathname !== "" && parsedUrl.pathname !== "/") {
    ctx.addIssue({
      code: "custom",
      message: "Atlassian site URLs must not include a path.",
    });
  }

  if (parsedUrl.search.length > 0 || parsedUrl.hash.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: "Atlassian site URLs must not include a query string or hash.",
    });
  }

  if (parsedUrl.username.length > 0 || parsedUrl.password.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: "Atlassian site URLs must not include user info.",
    });
  }
});

export const AtlassianPersonalApiTokenConnectionConfigSchema = z
  .object({
    connection_method: z.literal(AtlassianConnectionMethodIds.PERSONAL_API_TOKEN),
    site_url: AtlassianSiteUrlSchema,
    email: z.email(),
  })
  .strict();

export const AtlassianServiceAccountApiTokenConnectionConfigSchema = z
  .object({
    connection_method: z.literal(AtlassianConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN),
    cloud_id: z.string().trim().min(1),
  })
  .strict();

export const AtlassianServiceAccountOauthClientCredentialsConnectionConfigSchema = z
  .object({
    connection_method: z.literal(
      AtlassianConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
    ),
    cloud_id: z.string().trim().min(1),
    client_id: z.string().trim().min(1),
  })
  .strict();

export const AtlassianConnectionConfigSchema = z.discriminatedUnion("connection_method", [
  AtlassianPersonalApiTokenConnectionConfigSchema,
  AtlassianServiceAccountApiTokenConnectionConfigSchema,
  AtlassianServiceAccountOauthClientCredentialsConnectionConfigSchema,
]);

export type AtlassianConnectionConfig = z.output<typeof AtlassianConnectionConfigSchema>;

export function resolveAtlassianCredentialSecretType(
  input: unknown,
): "api_key" | "oauth2_client_secret" {
  const parsedConfig = AtlassianConnectionConfigSchema.parse(input);

  if (
    parsedConfig.connection_method ===
    AtlassianConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS
  ) {
    return AtlassianCredentialSecretTypes.OAUTH2_CLIENT_SECRET;
  }

  return AtlassianCredentialSecretTypes.API_KEY;
}
