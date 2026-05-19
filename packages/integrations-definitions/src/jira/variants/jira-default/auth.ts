import { z } from "zod";

export const JiraConnectionMethodIds = {
  PERSONAL_API_TOKEN: "jira-personal-api-token",
  SERVICE_ACCOUNT_API_TOKEN: "jira-service-account-api-token",
  SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS: "jira-service-account-oauth-client-credentials",
} as const;

export const JiraCredentialSecretTypes = {
  API_KEY: "api_key",
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
  OAUTH2_CLIENT_SECRET: "oauth2_client_secret",
} as const;

export const JiraCredentialSlotKeys = {
  PERSONAL_API_TOKEN_API_KEY: "jira.jira-default.jira-personal-api-token.api-key",
  SERVICE_ACCOUNT_API_TOKEN_API_KEY: "jira.jira-default.jira-service-account-api-token.api-key",
  SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS_CLIENT_SECRET:
    "jira.jira-default.jira-service-account-oauth-client-credentials.client-secret",
  SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS_ACCESS_TOKEN:
    "jira.jira-default.jira-service-account-oauth-client-credentials.access-token",
} as const;

export function normalizeJiraBaseUrl(input: string): string {
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

function tryParseJiraSiteUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isValidJiraCloudSiteName(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) && value.length >= 3;
}

const JiraSiteUrlSchema = z.url().superRefine((value, ctx) => {
  const parsedUrl = tryParseJiraSiteUrl(value);
  if (parsedUrl === null) {
    return;
  }

  if (parsedUrl.protocol !== "https:") {
    ctx.addIssue({
      code: "custom",
      message: "Jira site URLs must use https.",
    });
  }

  if (!parsedUrl.hostname.endsWith(".atlassian.net")) {
    ctx.addIssue({
      code: "custom",
      message: "Jira site URLs must use an *.atlassian.net hostname.",
    });
  }

  const atlassianNetSuffix = ".atlassian.net";
  if (parsedUrl.hostname.endsWith(atlassianNetSuffix)) {
    const siteName = parsedUrl.hostname.slice(0, -atlassianNetSuffix.length);
    if (!isValidJiraCloudSiteName(siteName)) {
      ctx.addIssue({
        code: "custom",
        message:
          "Jira site names must be at least 3 characters and use lowercase letters, numbers, or middle hyphens.",
      });
    }
  }

  if (parsedUrl.pathname !== "" && parsedUrl.pathname !== "/") {
    ctx.addIssue({
      code: "custom",
      message: "Jira site URLs must not include a path.",
    });
  }

  if (parsedUrl.search.length > 0 || parsedUrl.hash.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: "Jira site URLs must not include a query string or hash.",
    });
  }

  if (parsedUrl.username.length > 0 || parsedUrl.password.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: "Jira site URLs must not include user info.",
    });
  }
});

export const JiraPersonalApiTokenConnectionConfigSchema = z
  .object({
    connection_method: z.literal(JiraConnectionMethodIds.PERSONAL_API_TOKEN),
    site_url: JiraSiteUrlSchema,
    email: z.email(),
  })
  .strict();

export const JiraServiceAccountApiTokenConnectionConfigSchema = z
  .object({
    connection_method: z.literal(JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN),
    cloud_id: z.string().trim().min(1),
  })
  .strict();

export const JiraServiceAccountOauthClientCredentialsConnectionConfigSchema = z
  .object({
    connection_method: z.literal(JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS),
    cloud_id: z.string().trim().min(1),
    client_id: z.string().trim().min(1),
  })
  .strict();

export const JiraConnectionConfigSchema = z.discriminatedUnion("connection_method", [
  JiraPersonalApiTokenConnectionConfigSchema,
  JiraServiceAccountApiTokenConnectionConfigSchema,
  JiraServiceAccountOauthClientCredentialsConnectionConfigSchema,
]);

export type JiraConnectionConfig = z.output<typeof JiraConnectionConfigSchema>;

export function resolveJiraCredentialSecretType(
  input: unknown,
): "api_key" | "oauth2_client_secret" {
  const parsedConfig = JiraConnectionConfigSchema.parse(input);

  if (
    parsedConfig.connection_method ===
    JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS
  ) {
    return JiraCredentialSecretTypes.OAUTH2_CLIENT_SECRET;
  }

  return JiraCredentialSecretTypes.API_KEY;
}
