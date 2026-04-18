import { createHash } from "node:crypto";

import { z } from "zod";

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

const GitHubUserProfileResponseSchema = z
  .object({
    id: z.number().int().nonnegative(),
    login: z.string().min(1),
    name: z.string().min(1).nullable().optional(),
    email: z.email().nullable().optional(),
    avatar_url: z.url().optional(),
  })
  .strict();

const GitHubUserEmailResponseSchema = z
  .array(
    z
      .object({
        email: z.email(),
        primary: z.boolean(),
        verified: z.boolean(),
      })
      .strict(),
  )
  .readonly();

export class GitHubIdentityLinkingAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubIdentityLinkingAuthorizationError";
  }
}

export type GitHubLinkedAccountAuthorizationResult = {
  providerSubjectId: string;
  profile: {
    login: string;
    displayName?: string;
    avatarUrl?: string;
    email?: string;
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
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUrl,
      code_verifier: input.pkceVerifier,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new GitHubIdentityLinkingAuthorizationError(
      `GitHub rejected the authorization code exchange (${response.status} ${response.statusText}): ${responseText}`,
    );
  }

  return readJsonResponseOrThrow({
    response,
    schema: GitHubUserAccessTokenResponseSchema,
    errorLabel: "GitHub authorization code exchange",
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
      "x-github-api-version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub user profile request failed (${response.status} ${response.statusText}).`,
    );
  }

  return readJsonResponseOrThrow({
    response,
    schema: GitHubUserProfileResponseSchema,
    errorLabel: "GitHub user profile request",
  });
}

async function fetchPrimaryEmail(input: {
  apiBaseUrl: string;
  accessToken: string;
}): Promise<string | undefined> {
  const emailsUrl = new URL("/user/emails", input.apiBaseUrl);
  const response = await fetch(emailsUrl, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.accessToken}`,
      "x-github-api-version": "2022-11-28",
    },
  });

  if (!response.ok) {
    return undefined;
  }

  const emails = await readJsonResponseOrThrow({
    response,
    schema: GitHubUserEmailResponseSchema,
    errorLabel: "GitHub user emails request",
  });

  return emails.find((email) => email.primary && email.verified)?.email;
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
  const primaryEmail =
    userProfile.email ??
    (await fetchPrimaryEmail({
      apiBaseUrl: input.apiBaseUrl,
      accessToken: tokenResponse.access_token,
    }));
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
      ...(primaryEmail === undefined ? {} : { email: primaryEmail }),
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
