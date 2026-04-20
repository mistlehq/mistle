import { createHash, randomBytes } from "node:crypto";

import {
  IntegrationConnectionMethodIds,
  type CompletedIdentityLinkingAuthorization,
  type IntegrationIdentityLinkingCapability,
  type RefreshedIdentityLinkingCredential,
} from "@mistle/integrations-core";
import { z } from "zod";

import { GitHubApiVersion } from "./api-version.js";
import type { GitHubConnectionConfig } from "./auth.js";
import { parseGitHubAppInstallationConnectionConfig } from "./auth.js";
import { GitHubCredentialSlotKeys } from "./slot-keys.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";

const GitHubPkceChallengeMethod = "S256" as const;

const GitHubAuthorizationCallbackErrorSchema = z
  .object({
    error: z.string().min(1),
    error_description: z.string().min(1).optional(),
  })
  .strict();

const GitHubUserAccessTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().nonnegative().optional(),
    refresh_token: z.string().min(1).optional(),
    refresh_token_expires_in: z.number().int().nonnegative().optional(),
    scope: z.string(),
    token_type: z.literal("bearer"),
  })
  .strict();

const GitHubUserAccessTokenErrorResponseSchema = z
  .object({
    error: z.string().min(1),
    error_description: z.string().min(1).optional(),
    error_uri: z.string().min(1).optional(),
  })
  .strict();

const GitHubUserProfileResponseSchema = z
  .object({
    id: z.number().int().nonnegative(),
    login: z.string().min(1),
    name: z.string().min(1).nullable().optional(),
    email: z.email().nullable().optional(),
    avatar_url: z.url().optional(),
  })
  .loose();

const GitHubUserEmailResponseSchema = z
  .array(
    z
      .object({
        email: z.email(),
        primary: z.boolean(),
        verified: z.boolean(),
      })
      .loose(),
  )
  .readonly();

export class GitHubIdentityLinkingAuthorizationError extends Error {
  readonly code = "IDENTITY_LINKING_AUTHORIZATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "GitHubIdentityLinkingAuthorizationError";
  }
}

export class GitHubIdentityLinkingConfigurationError extends Error {
  readonly code = "IDENTITY_LINKING_INVALID_PROVIDER_CONFIG";

  constructor(message: string) {
    super(message);
    this.name = "GitHubIdentityLinkingConfigurationError";
  }
}

export type GitHubLinkedEmail = {
  email: string;
  primary: boolean;
  verified: true;
};

export type GitHubLinkedAccountAuthorizationResult = {
  providerSubjectId: string;
  profile: {
    login: string;
    displayName?: string;
    avatarUrl?: string;
    preferredEmail?: string;
    availableEmails?: readonly GitHubLinkedEmail[];
  };
  keys: readonly [
    {
      keyType: "account_id";
      keyValue: string;
    },
    {
      keyType: "login";
      keyValue: string;
    },
  ];
  credential: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt?: string;
    refreshTokenExpiresAt?: string;
    scopes?: string[];
  };
};

function toCompletedIdentityLinkingAuthorization(
  input: GitHubLinkedAccountAuthorizationResult,
): CompletedIdentityLinkingAuthorization {
  return {
    providerSubjectId: input.providerSubjectId,
    profile: input.profile,
    keys: input.keys,
    credential: {
      credentialKind: "github_app_user_access_token",
      ...(input.credential.scopes === undefined ? {} : { scopes: input.credential.scopes }),
      ...(input.credential.accessTokenExpiresAt === undefined
        ? {}
        : { accessTokenExpiresAt: input.credential.accessTokenExpiresAt }),
      ...(input.credential.refreshTokenExpiresAt === undefined
        ? {}
        : { refreshTokenExpiresAt: input.credential.refreshTokenExpiresAt }),
      secrets: [
        {
          secretKind: "oauth2_access_token",
          plaintext: input.credential.accessToken,
        },
        {
          secretKind: "oauth2_refresh_token",
          plaintext: input.credential.refreshToken,
        },
      ],
    },
  };
}

function resolveGitHubClientIdOrThrow(input: {
  connection: {
    id: string;
    config: Record<string, unknown>;
  };
}): string {
  const connectionConfig = parseGitHubAppInstallationConnectionConfig(input.connection.config);
  const clientId = connectionConfig.client_id?.trim();

  if (clientId === undefined || clientId.length === 0) {
    throw new GitHubIdentityLinkingConfigurationError(
      `Integration connection '${input.connection.id}' is missing GitHub App client_id.`,
    );
  }

  return clientId;
}

function resolveFutureTimestamp(input: {
  now: string;
  expiresInSeconds: number | undefined;
}): string | undefined {
  if (input.expiresInSeconds === undefined) {
    return undefined;
  }

  const nowTimestamp = Date.parse(input.now);
  if (Number.isNaN(nowTimestamp)) {
    throw new Error(`Invalid reference timestamp '${input.now}'.`);
  }

  return new Date(nowTimestamp + input.expiresInSeconds * 1000).toISOString();
}

async function readJsonResponseOrThrow<T>(input: {
  response: Response;
  schema: z.ZodType<T>;
  errorLabel: string;
}): Promise<T> {
  const contentType = input.response.headers.get("content-type");
  if (contentType === null || !contentType.includes("application/json")) {
    throw new Error(`${input.errorLabel} did not return JSON.`);
  }

  const parsedJson = await input.response.json();
  return input.schema.parse(parsedJson);
}

async function readGitHubUserAccessTokenResponseOrThrow(input: {
  response: Response;
  errorLabel: string;
}): Promise<z.infer<typeof GitHubUserAccessTokenResponseSchema>> {
  const contentType = input.response.headers.get("content-type");
  if (contentType === null || !contentType.includes("application/json")) {
    throw new GitHubIdentityLinkingAuthorizationError(`${input.errorLabel} did not return JSON.`);
  }

  const parsedJson: unknown = await input.response.json();
  const parsedError = GitHubUserAccessTokenErrorResponseSchema.safeParse(parsedJson);
  if (parsedError.success) {
    const description =
      parsedError.data.error_description === undefined
        ? parsedError.data.error
        : `${parsedError.data.error}: ${parsedError.data.error_description}`;
    throw new GitHubIdentityLinkingAuthorizationError(`${input.errorLabel} failed: ${description}`);
  }

  const parsedTokenResponse = GitHubUserAccessTokenResponseSchema.safeParse(parsedJson);
  if (parsedTokenResponse.success) {
    return parsedTokenResponse.data;
  }

  throw new GitHubIdentityLinkingAuthorizationError(
    `${input.errorLabel} returned an invalid response.`,
  );
}

function toGitHubAuthorizationFailure(input: {
  errorLabel: string;
  error: unknown;
}): GitHubIdentityLinkingAuthorizationError {
  if (input.error instanceof GitHubIdentityLinkingAuthorizationError) {
    return input.error;
  }

  const detail =
    input.error instanceof Error ? input.error.message : "GitHub returned an invalid response.";

  return new GitHubIdentityLinkingAuthorizationError(`${input.errorLabel} failed: ${detail}`);
}

function createAuthorizationErrorFromCallbackOrThrow(
  query: URLSearchParams,
): GitHubIdentityLinkingAuthorizationError | undefined {
  const rawError = query.get("error");
  if (rawError === null) {
    return undefined;
  }

  const parsed = GitHubAuthorizationCallbackErrorSchema.parse({
    error: rawError,
    ...(query.get("error_description") === null
      ? {}
      : { error_description: query.get("error_description") }),
  });

  const description =
    parsed.error_description === undefined
      ? parsed.error
      : `${parsed.error}: ${parsed.error_description}`;

  return new GitHubIdentityLinkingAuthorizationError(
    `GitHub authorization was not completed successfully (${description}).`,
  );
}

function resolveAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const callbackError = createAuthorizationErrorFromCallbackOrThrow(query);
  if (callbackError !== undefined) {
    throw callbackError;
  }

  const code = query.get("code");
  if (code === null || code.trim().length === 0) {
    throw new GitHubIdentityLinkingAuthorizationError(
      "GitHub authorization callback did not include an authorization code.",
    );
  }

  return code;
}

function buildGitHubUserAuthorizationUrl(input: {
  webBaseUrl: string;
  clientId: string;
  state: string;
  redirectUrl: string;
  pkceChallenge: string;
}): string {
  const authorizationUrl = new URL("/login/oauth/authorize", input.webBaseUrl);
  authorizationUrl.searchParams.set("client_id", input.clientId);
  authorizationUrl.searchParams.set("redirect_uri", input.redirectUrl);
  authorizationUrl.searchParams.set("state", input.state);
  authorizationUrl.searchParams.set("code_challenge", input.pkceChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", GitHubPkceChallengeMethod);
  return authorizationUrl.toString();
}

function resolveScopes(scope: string): string[] | undefined {
  const normalizedScopes = scope
    .split(",")
    .flatMap((entry) => entry.split(" "))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (normalizedScopes.length === 0) {
    return undefined;
  }

  return [...new Set(normalizedScopes)];
}

async function exchangeAuthorizationCode(input: {
  webBaseUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUrl: string;
  pkceVerifier: string;
}): Promise<z.infer<typeof GitHubUserAccessTokenResponseSchema>> {
  const tokenUrl = new URL("/login/oauth/access_token", input.webBaseUrl);
  // GitHub's GitHub App user-token docs define these as query parameters on the POST
  // request to /login/oauth/access_token, not as a form-encoded request body.
  // https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
  tokenUrl.searchParams.set("client_id", input.clientId);
  tokenUrl.searchParams.set("client_secret", input.clientSecret);
  tokenUrl.searchParams.set("code", input.code);
  tokenUrl.searchParams.set("redirect_uri", input.redirectUrl);
  tokenUrl.searchParams.set("code_verifier", input.pkceVerifier);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new GitHubIdentityLinkingAuthorizationError(
      `GitHub rejected the authorization code exchange (${response.status} ${response.statusText}): ${responseText}`,
    );
  }

  return await readGitHubUserAccessTokenResponseOrThrow({
    response,
    errorLabel: "GitHub authorization code exchange",
  });
}

async function refreshUserAccessToken(input: {
  webBaseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<z.infer<typeof GitHubUserAccessTokenResponseSchema>> {
  const tokenUrl = new URL("/login/oauth/access_token", input.webBaseUrl);
  // GitHub documents refresh-token exchange for GitHub App user tokens as a POST
  // to /login/oauth/access_token with query parameters, including grant_type and
  // refresh_token.
  // https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
  tokenUrl.searchParams.set("client_id", input.clientId);
  tokenUrl.searchParams.set("client_secret", input.clientSecret);
  tokenUrl.searchParams.set("grant_type", "refresh_token");
  tokenUrl.searchParams.set("refresh_token", input.refreshToken);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new GitHubIdentityLinkingAuthorizationError(
      `GitHub refresh token exchange failed (${response.status} ${response.statusText}): ${responseText}`,
    );
  }

  return await readGitHubUserAccessTokenResponseOrThrow({
    response,
    errorLabel: "GitHub refresh token exchange",
  });
}

async function fetchUserProfile(input: {
  apiBaseUrl: string;
  accessToken: string;
}): Promise<z.infer<typeof GitHubUserProfileResponseSchema>> {
  const profileUrl = new URL("/user", input.apiBaseUrl);
  const response = await fetch(profileUrl, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.accessToken}`,
      "x-github-api-version": GitHubApiVersion,
    },
  });

  if (!response.ok) {
    throw new GitHubIdentityLinkingAuthorizationError(
      `GitHub user profile request failed (${response.status} ${response.statusText}).`,
    );
  }

  try {
    return await readJsonResponseOrThrow({
      response,
      schema: GitHubUserProfileResponseSchema,
      errorLabel: "GitHub user profile request",
    });
  } catch (error) {
    throw toGitHubAuthorizationFailure({
      errorLabel: "GitHub user profile request",
      error,
    });
  }
}

async function fetchAvailableEmails(input: {
  apiBaseUrl: string;
  accessToken: string;
}): Promise<readonly GitHubLinkedEmail[] | undefined> {
  const emailsUrl = new URL("/user/emails", input.apiBaseUrl);
  const response = await fetch(emailsUrl, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.accessToken}`,
      "x-github-api-version": GitHubApiVersion,
    },
  });

  if (!response.ok) {
    throw new GitHubIdentityLinkingAuthorizationError(
      `GitHub user emails request failed (${response.status} ${response.statusText}).`,
    );
  }

  let emails: z.infer<typeof GitHubUserEmailResponseSchema>;
  try {
    emails = await readJsonResponseOrThrow({
      response,
      schema: GitHubUserEmailResponseSchema,
      errorLabel: "GitHub user emails request",
    });
  } catch (error) {
    throw toGitHubAuthorizationFailure({
      errorLabel: "GitHub user emails request",
      error,
    });
  }

  return emails
    .filter((email) => email.verified)
    .map((email) => ({
      email: email.email,
      primary: email.primary,
      verified: true,
    }));
}

export function createGitHubIdentityLinkPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function startGitHubLinkedAccountAuthorization(input: {
  webBaseUrl: string;
  clientId: string;
  state: string;
  redirectUrl: string;
  pkceVerifier: string;
}): {
  authorizationUrl: string;
} {
  return {
    authorizationUrl: buildGitHubUserAuthorizationUrl({
      webBaseUrl: input.webBaseUrl,
      clientId: input.clientId,
      state: input.state,
      redirectUrl: input.redirectUrl,
      pkceChallenge: createGitHubIdentityLinkPkceChallenge(input.pkceVerifier),
    }),
  };
}

export async function completeGitHubLinkedAccountAuthorization(input: {
  apiBaseUrl: string;
  webBaseUrl: string;
  clientId: string;
  clientSecret: string;
  query: URLSearchParams;
  redirectUrl: string;
  pkceVerifier: string;
  now: string;
}): Promise<GitHubLinkedAccountAuthorizationResult> {
  const authorizationCode = resolveAuthorizationCodeOrThrow(input.query);
  const tokenResponse = await exchangeAuthorizationCode({
    webBaseUrl: input.webBaseUrl,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    code: authorizationCode,
    redirectUrl: input.redirectUrl,
    pkceVerifier: input.pkceVerifier,
  });
  if (tokenResponse.refresh_token === undefined) {
    throw new GitHubIdentityLinkingAuthorizationError(
      "GitHub authorization code exchange did not return a refresh token.",
    );
  }
  const userProfile = await fetchUserProfile({
    apiBaseUrl: input.apiBaseUrl,
    accessToken: tokenResponse.access_token,
  });
  // /user.email is only the user's publicly visible profile email. To resolve the
  // actual primary email when GitHub makes it available, prefer /user/emails.
  // https://docs.github.com/en/rest/users/users
  // https://docs.github.com/en/rest/users/emails
  const availableEmails = await fetchAvailableEmails({
    apiBaseUrl: input.apiBaseUrl,
    accessToken: tokenResponse.access_token,
  });
  const primaryEmail = availableEmails?.find((email) => email.primary)?.email;
  const preferredEmail = primaryEmail ?? userProfile.email ?? undefined;
  const accessTokenExpiresAt = resolveFutureTimestamp({
    now: input.now,
    expiresInSeconds: tokenResponse.expires_in,
  });
  const refreshTokenExpiresAt = resolveFutureTimestamp({
    now: input.now,
    expiresInSeconds: tokenResponse.refresh_token_expires_in,
  });
  const scopes = resolveScopes(tokenResponse.scope);

  return {
    providerSubjectId: userProfile.id.toString(),
    profile: {
      login: userProfile.login,
      ...(userProfile.name === null || userProfile.name === undefined
        ? {}
        : { displayName: userProfile.name }),
      ...(userProfile.avatar_url === undefined ? {} : { avatarUrl: userProfile.avatar_url }),
      ...(preferredEmail === undefined ? {} : { preferredEmail }),
      ...(availableEmails === undefined ? {} : { availableEmails }),
    },
    keys: [
      {
        keyType: "account_id",
        keyValue: userProfile.id.toString(),
      },
      {
        keyType: "login",
        keyValue: userProfile.login,
      },
    ],
    credential: {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      ...(accessTokenExpiresAt === undefined ? {} : { accessTokenExpiresAt }),
      ...(refreshTokenExpiresAt === undefined ? {} : { refreshTokenExpiresAt }),
      ...(scopes === undefined ? {} : { scopes }),
    },
  };
}

export async function refreshGitHubLinkedAccountCredential(input: {
  webBaseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  now: string;
}): Promise<RefreshedIdentityLinkingCredential> {
  const tokenResponse = await refreshUserAccessToken({
    webBaseUrl: input.webBaseUrl,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    refreshToken: input.refreshToken,
  });

  if (tokenResponse.refresh_token === undefined) {
    throw new GitHubIdentityLinkingAuthorizationError(
      "GitHub refresh token exchange did not return a refresh token.",
    );
  }

  const accessTokenExpiresAt = resolveFutureTimestamp({
    now: input.now,
    expiresInSeconds: tokenResponse.expires_in,
  });
  const refreshTokenExpiresAt = resolveFutureTimestamp({
    now: input.now,
    expiresInSeconds: tokenResponse.refresh_token_expires_in,
  });
  const scopes = resolveScopes(tokenResponse.scope);

  return {
    credentialKind: "github_app_user_access_token",
    ...(scopes === undefined ? {} : { scopes }),
    ...(accessTokenExpiresAt === undefined ? {} : { accessTokenExpiresAt }),
    ...(refreshTokenExpiresAt === undefined ? {} : { refreshTokenExpiresAt }),
    secrets: [
      {
        secretKind: "oauth2_access_token",
        plaintext: tokenResponse.access_token,
      },
      {
        secretKind: "oauth2_refresh_token",
        plaintext: tokenResponse.refresh_token,
      },
    ],
  };
}

export const GitHubIdentityLinkingCapability: IntegrationIdentityLinkingCapability<
  GitHubTargetConfig,
  Record<string, string>,
  GitHubConnectionConfig
> = {
  eligibleConnectionMethodIds: [IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION],
  supportsConnection(input) {
    const connectionMethod = input.connection.config.connection_method;
    if (connectionMethod !== IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION) {
      return false;
    }

    try {
      resolveGitHubClientIdOrThrow({
        connection: input.connection,
      });
    } catch (error) {
      if (error instanceof GitHubIdentityLinkingConfigurationError) {
        return false;
      }

      throw error;
    }

    return input.availableConnectionSecretSlotKeys.has(
      GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_CLIENT_SECRET,
    );
  },
  async startAuthorization(input) {
    const clientId = resolveGitHubClientIdOrThrow({
      connection: input.connection,
    });

    try {
      await input.resolveConnectionSecret({
        slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_CLIENT_SECRET,
      });
    } catch {
      throw new GitHubIdentityLinkingConfigurationError(
        `Integration connection '${input.connection.id}' is missing GitHub App client secret.`,
      );
    }

    const pkceVerifier = randomBytes(32).toString("base64url");
    const startedAuthorization = startGitHubLinkedAccountAuthorization({
      webBaseUrl: input.target.config.webBaseUrl,
      clientId,
      state: input.state,
      redirectUrl: input.redirectUrl,
      pkceVerifier,
    });

    return {
      authorizationUrl: startedAuthorization.authorizationUrl,
      pkceVerifier,
    };
  },
  async completeAuthorization(input) {
    if (input.pkceVerifier === undefined) {
      throw new GitHubIdentityLinkingAuthorizationError(
        "GitHub linked-account callback is missing the PKCE verifier.",
      );
    }

    const clientId = resolveGitHubClientIdOrThrow({
      connection: input.connection,
    });

    let clientSecret: string;
    try {
      clientSecret = await input.resolveConnectionSecret({
        slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_CLIENT_SECRET,
      });
    } catch {
      throw new GitHubIdentityLinkingConfigurationError(
        `Integration connection '${input.connection.id}' is missing GitHub App client secret.`,
      );
    }

    const completedAuthorization = await completeGitHubLinkedAccountAuthorization({
      apiBaseUrl: input.target.config.apiBaseUrl,
      webBaseUrl: input.target.config.webBaseUrl,
      clientId,
      clientSecret,
      query: input.query,
      redirectUrl: input.redirectUrl,
      pkceVerifier: input.pkceVerifier,
      now: input.now,
    });

    return toCompletedIdentityLinkingAuthorization(completedAuthorization);
  },
  async refreshCredential(input): Promise<RefreshedIdentityLinkingCredential> {
    const clientId = resolveGitHubClientIdOrThrow({
      connection: input.connection,
    });

    let clientSecret: string;
    try {
      clientSecret = await input.resolveConnectionSecret({
        slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_CLIENT_SECRET,
      });
    } catch {
      throw new GitHubIdentityLinkingConfigurationError(
        `Integration connection '${input.connection.id}' is missing GitHub App client secret.`,
      );
    }

    const refreshToken = await input.resolveCredentialSecret({
      secretKind: "oauth2_refresh_token",
    });

    return await refreshGitHubLinkedAccountCredential({
      webBaseUrl: input.target.config.webBaseUrl,
      clientId,
      clientSecret,
      refreshToken,
      now: input.now,
    });
  },
};
