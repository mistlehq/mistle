import {
  type CompletedIdentityLinkingAuthorization,
  type IdentityLinkingPrincipalKey,
  type IntegrationIdentityLinkingCapability,
  type IntegrationWebhookEvent,
  type RefreshedIdentityLinkingCredential,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  SlackConnectionConfigSchema,
  SlackConnectionMethodId,
  type SlackConnectionConfig,
  SlackCredentialSlotKeys,
} from "./auth.js";
import type { SlackTargetConfig } from "./target-config-schema.js";

const SlackUserScope = "users.profile:read,users:read,users:read.email";

const SlackAuthorizationCallbackErrorSchema = z
  .object({
    error: z.string().min(1),
    error_description: z.string().min(1).optional(),
  })
  .strict();

const SlackOAuthAccessErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z.string().min(1),
    needed: z.string().min(1).optional(),
    provided: z.string().min(1).optional(),
  })
  .loose();

const SlackOAuthAuthedUserSchema = z
  .object({
    id: z.string().min(1),
    scope: z.string().optional(),
    access_token: z.string().min(1),
    expires_in: z.number().int().positive().optional(),
    refresh_token: z.string().min(1).optional(),
    token_type: z.literal("user").optional(),
  })
  .loose();

const SlackOAuthAccessSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    team: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1).optional(),
      })
      .loose(),
    authed_user: SlackOAuthAuthedUserSchema,
  })
  .loose();

const SlackUserProfileErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z.string().min(1),
  })
  .loose();

const SlackUserProfileResponseSchema = z
  .object({
    ok: z.literal(true),
    profile: z
      .object({
        display_name: z.string().optional(),
        real_name: z.string().optional(),
        image_192: z.url().optional(),
        email: z.email().optional(),
      })
      .loose(),
  })
  .loose();

export class SlackIdentityLinkingAuthorizationError extends Error {
  readonly code = "IDENTITY_LINKING_AUTHORIZATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "SlackIdentityLinkingAuthorizationError";
  }
}

export class SlackIdentityLinkingConfigurationError extends Error {
  readonly code = "IDENTITY_LINKING_INVALID_PROVIDER_CONFIG";

  constructor(message: string) {
    super(message);
    this.name = "SlackIdentityLinkingConfigurationError";
  }
}

function resolveOptionalSlackStringField(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = input[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length === 0 ? undefined : trimmedValue;
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

function resolveSlackWebBaseUrl(apiBaseUrl: string): string {
  const apiUrl = new URL(apiBaseUrl);
  apiUrl.pathname = "";
  apiUrl.search = "";
  apiUrl.hash = "";
  return apiUrl.toString();
}

function buildSlackApiUrl(input: { apiBaseUrl: string; path: string }): URL {
  const apiUrl = new URL(input.apiBaseUrl);
  const normalizedBasePath = apiUrl.pathname === "/" ? "" : apiUrl.pathname.replace(/\/$/, "");
  apiUrl.pathname = `${normalizedBasePath}/${input.path.replace(/^\//, "")}`;
  apiUrl.search = "";
  apiUrl.hash = "";
  return apiUrl;
}

function resolveSlackClientIdOrThrow(input: {
  connection: {
    id: string;
    config: Record<string, unknown>;
  };
}): string {
  const connectionConfig = SlackConnectionConfigSchema.parse(input.connection.config);
  if (connectionConfig.connection_method !== SlackConnectionMethodId) {
    throw new SlackIdentityLinkingConfigurationError(
      `Integration connection '${input.connection.id}' does not use the Slack app connection method required for identity linking.`,
    );
  }

  const clientId = connectionConfig.client_id?.trim();
  if (clientId === undefined || clientId.length === 0) {
    throw new SlackIdentityLinkingConfigurationError(
      `Integration connection '${input.connection.id}' is missing Slack app client_id.`,
    );
  }

  return clientId;
}

function resolveScopes(scope: string | undefined): string[] | undefined {
  if (scope === undefined) {
    return undefined;
  }

  const normalizedScopes = scope
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (normalizedScopes.length === 0) {
    return undefined;
  }

  return [...new Set(normalizedScopes)];
}

function resolveSlackWebhookActorKeys(
  event: IntegrationWebhookEvent,
): readonly [IdentityLinkingPrincipalKey, ...IdentityLinkingPrincipalKey[]] | null {
  const teamId = resolveOptionalSlackStringField(event.payload, "team_id");
  const rawEvent = event.payload["event"];
  if (typeof rawEvent !== "object" || rawEvent === null || Array.isArray(rawEvent)) {
    return null;
  }

  const userId = resolveOptionalSlackStringField(
    Object.fromEntries(Object.entries(rawEvent)),
    "user",
  );
  if (teamId === undefined || userId === undefined) {
    return null;
  }

  return [
    {
      keyType: "workspace_id",
      keyValue: teamId,
    },
    {
      keyType: "user_id",
      keyValue: userId,
    },
  ];
}

function toCompletedIdentityLinkingAuthorization(
  input: Awaited<ReturnType<typeof completeSlackLinkedAccountAuthorization>>,
): CompletedIdentityLinkingAuthorization {
  return {
    providerSubjectId: input.providerSubjectId,
    profile: input.profile,
    keys: input.keys,
    credential: {
      credentialKind: "slack_user_token",
      ...(input.credential.scopes === undefined ? {} : { scopes: input.credential.scopes }),
      ...(input.credential.accessTokenExpiresAt === undefined
        ? {}
        : { accessTokenExpiresAt: input.credential.accessTokenExpiresAt }),
      secrets: [
        {
          secretKind: "oauth2_access_token",
          plaintext: input.credential.accessToken,
        },
        ...(input.credential.refreshToken === undefined
          ? []
          : [
              {
                secretKind: "oauth2_refresh_token" as const,
                plaintext: input.credential.refreshToken,
              },
            ]),
      ],
    },
  };
}

function createAuthorizationErrorFromCallbackOrThrow(
  query: URLSearchParams,
): SlackIdentityLinkingAuthorizationError | undefined {
  const rawError = query.get("error");
  if (rawError === null) {
    return undefined;
  }

  const parsed = SlackAuthorizationCallbackErrorSchema.parse({
    error: rawError,
    ...(query.get("error_description") === null
      ? {}
      : { error_description: query.get("error_description") }),
  });

  const description =
    parsed.error_description === undefined
      ? parsed.error
      : `${parsed.error}: ${parsed.error_description}`;

  return new SlackIdentityLinkingAuthorizationError(
    `Slack authorization was not completed successfully (${description}).`,
  );
}

function resolveAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const callbackError = createAuthorizationErrorFromCallbackOrThrow(query);
  if (callbackError !== undefined) {
    throw callbackError;
  }

  const code = query.get("code");
  if (code === null || code.trim().length === 0) {
    throw new SlackIdentityLinkingAuthorizationError(
      "Slack authorization callback did not include an authorization code.",
    );
  }

  return code;
}

async function readSlackJsonResponseOrThrow<T>(input: {
  response: Response;
  schema: z.ZodType<T>;
  errorLabel: string;
}): Promise<T> {
  const contentType = input.response.headers.get("content-type");
  if (contentType === null || !contentType.includes("application/json")) {
    throw new SlackIdentityLinkingAuthorizationError(`${input.errorLabel} did not return JSON.`);
  }

  const parsedJson = await input.response.json();
  return input.schema.parse(parsedJson);
}

async function readSlackOAuthAccessResponseOrThrow(input: {
  response: Response;
  errorLabel: string;
}): Promise<z.infer<typeof SlackOAuthAccessSuccessResponseSchema>> {
  const contentType = input.response.headers.get("content-type");
  if (contentType === null || !contentType.includes("application/json")) {
    throw new SlackIdentityLinkingAuthorizationError(`${input.errorLabel} did not return JSON.`);
  }

  const parsedJson: unknown = await input.response.json();
  const parsedError = SlackOAuthAccessErrorResponseSchema.safeParse(parsedJson);
  if (parsedError.success) {
    throw new SlackIdentityLinkingAuthorizationError(
      `${input.errorLabel} failed: ${parsedError.data.error}`,
    );
  }

  const parsedSuccess = SlackOAuthAccessSuccessResponseSchema.safeParse(parsedJson);
  if (parsedSuccess.success) {
    return parsedSuccess.data;
  }

  throw new SlackIdentityLinkingAuthorizationError(
    `${input.errorLabel} returned an invalid response.`,
  );
}

function toSlackAuthorizationFailure(input: {
  errorLabel: string;
  error: unknown;
}): SlackIdentityLinkingAuthorizationError {
  if (input.error instanceof SlackIdentityLinkingAuthorizationError) {
    return input.error;
  }

  const detail =
    input.error instanceof Error ? input.error.message : "Slack returned an invalid response.";

  return new SlackIdentityLinkingAuthorizationError(`${input.errorLabel} failed: ${detail}`);
}

function buildSlackUserAuthorizationUrl(input: {
  webBaseUrl: string;
  clientId: string;
  state: string;
  redirectUrl: string;
}): string {
  const authorizationUrl = new URL("/oauth/v2/authorize", input.webBaseUrl);
  authorizationUrl.searchParams.set("client_id", input.clientId);
  authorizationUrl.searchParams.set("user_scope", SlackUserScope);
  authorizationUrl.searchParams.set("redirect_uri", input.redirectUrl);
  authorizationUrl.searchParams.set("state", input.state);
  return authorizationUrl.toString();
}

async function exchangeAuthorizationCode(input: {
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUrl: string;
}): Promise<z.infer<typeof SlackOAuthAccessSuccessResponseSchema>> {
  const tokenUrl = buildSlackApiUrl({
    apiBaseUrl: input.apiBaseUrl,
    path: "/oauth.v2.access",
  });
  // Slack documents oauth.v2.access as a POST with application/x-www-form-urlencoded
  // parameters including client_id, client_secret, code, and redirect_uri.
  // https://docs.slack.dev/authentication/installing-with-oauth/
  const requestBody = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUrl,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: requestBody.toString(),
  });

  return await readSlackOAuthAccessResponseOrThrow({
    response,
    errorLabel: "Slack authorization code exchange",
  });
}

async function refreshSlackUserToken(input: {
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<z.infer<typeof SlackOAuthAccessSuccessResponseSchema>> {
  const tokenUrl = buildSlackApiUrl({
    apiBaseUrl: input.apiBaseUrl,
    path: "/oauth.v2.access",
  });
  // Slack documents refresh-token exchange for rotating user tokens on oauth.v2.access
  // using application/x-www-form-urlencoded POST parameters, including grant_type and
  // refresh_token.
  // https://docs.slack.dev/authentication/using-token-rotation/
  const requestBody = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: requestBody.toString(),
  });

  return await readSlackOAuthAccessResponseOrThrow({
    response,
    errorLabel: "Slack refresh token exchange",
  });
}

async function fetchSlackUserProfile(input: {
  apiBaseUrl: string;
  accessToken: string;
  userId: string;
}): Promise<z.infer<(typeof SlackUserProfileResponseSchema)["shape"]["profile"]>> {
  const profileUrl = buildSlackApiUrl({
    apiBaseUrl: input.apiBaseUrl,
    path: "/users.profile.get",
  });
  profileUrl.searchParams.set("user", input.userId);

  const response = await fetch(profileUrl, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new SlackIdentityLinkingAuthorizationError(
      `Slack user profile request failed (${response.status} ${response.statusText}).`,
    );
  }

  const parsed = await readSlackJsonResponseOrThrow({
    response,
    schema: z.union([SlackUserProfileResponseSchema, SlackUserProfileErrorResponseSchema]),
    errorLabel: "Slack user profile request",
  });

  if (!parsed.ok) {
    throw new SlackIdentityLinkingAuthorizationError(
      `Slack user profile request failed: ${parsed.error}`,
    );
  }

  return parsed.profile;
}

export function startSlackLinkedAccountAuthorization(input: {
  apiBaseUrl: string;
  clientId: string;
  state: string;
  redirectUrl: string;
}): {
  authorizationUrl: string;
} {
  return {
    authorizationUrl: buildSlackUserAuthorizationUrl({
      webBaseUrl: resolveSlackWebBaseUrl(input.apiBaseUrl),
      clientId: input.clientId,
      state: input.state,
      redirectUrl: input.redirectUrl,
    }),
  };
}

export async function completeSlackLinkedAccountAuthorization(input: {
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  query: URLSearchParams;
  redirectUrl: string;
  now: string;
}): Promise<{
  providerSubjectId: string;
  profile: {
    workspaceId: string;
    workspaceName?: string;
    displayName?: string;
    avatarUrl?: string;
    email?: string;
  };
  keys: readonly [
    {
      keyType: "workspace_id";
      keyValue: string;
    },
    {
      keyType: "user_id";
      keyValue: string;
    },
  ];
  credential: {
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresAt?: string;
    scopes?: string[];
  };
}> {
  const authorizationCode = resolveAuthorizationCodeOrThrow(input.query);
  const tokenResponse = await exchangeAuthorizationCode({
    apiBaseUrl: input.apiBaseUrl,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    code: authorizationCode,
    redirectUrl: input.redirectUrl,
  });

  const profile = await fetchSlackUserProfile({
    apiBaseUrl: input.apiBaseUrl,
    accessToken: tokenResponse.authed_user.access_token,
    userId: tokenResponse.authed_user.id,
  });

  const displayName = profile.display_name?.trim();
  const realName = profile.real_name?.trim();
  const resolvedDisplayName =
    displayName !== undefined && displayName.length > 0
      ? displayName
      : realName !== undefined && realName.length > 0
        ? realName
        : undefined;

  const accessTokenExpiresAt = resolveFutureTimestamp({
    now: input.now,
    expiresInSeconds: tokenResponse.authed_user.expires_in,
  });
  const scopes = resolveScopes(tokenResponse.authed_user.scope);

  return {
    providerSubjectId: `${tokenResponse.team.id}:${tokenResponse.authed_user.id}`,
    profile: {
      workspaceId: tokenResponse.team.id,
      ...(tokenResponse.team.name === undefined ? {} : { workspaceName: tokenResponse.team.name }),
      ...(resolvedDisplayName === undefined ? {} : { displayName: resolvedDisplayName }),
      ...(profile.image_192 === undefined ? {} : { avatarUrl: profile.image_192 }),
      ...(profile.email === undefined ? {} : { email: profile.email }),
    },
    keys: [
      {
        keyType: "workspace_id",
        keyValue: tokenResponse.team.id,
      },
      {
        keyType: "user_id",
        keyValue: tokenResponse.authed_user.id,
      },
    ],
    credential: {
      accessToken: tokenResponse.authed_user.access_token,
      ...(tokenResponse.authed_user.refresh_token === undefined
        ? {}
        : { refreshToken: tokenResponse.authed_user.refresh_token }),
      ...(accessTokenExpiresAt === undefined ? {} : { accessTokenExpiresAt }),
      ...(scopes === undefined ? {} : { scopes }),
    },
  };
}

export async function refreshSlackLinkedAccountCredential(input: {
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  now: string;
}): Promise<RefreshedIdentityLinkingCredential> {
  const tokenResponse = await refreshSlackUserToken({
    apiBaseUrl: input.apiBaseUrl,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    refreshToken: input.refreshToken,
  });

  if (tokenResponse.authed_user.refresh_token === undefined) {
    throw new SlackIdentityLinkingAuthorizationError(
      "Slack refresh token exchange did not return a refresh token.",
    );
  }

  const accessTokenExpiresAt = resolveFutureTimestamp({
    now: input.now,
    expiresInSeconds: tokenResponse.authed_user.expires_in,
  });
  const scopes = resolveScopes(tokenResponse.authed_user.scope);

  return {
    credentialKind: "slack_user_token",
    ...(scopes === undefined ? {} : { scopes }),
    ...(accessTokenExpiresAt === undefined ? {} : { accessTokenExpiresAt }),
    secrets: [
      {
        secretKind: "oauth2_access_token",
        plaintext: tokenResponse.authed_user.access_token,
      },
      {
        secretKind: "oauth2_refresh_token",
        plaintext: tokenResponse.authed_user.refresh_token,
      },
    ],
  };
}

export const SlackIdentityLinkingCapability: IntegrationIdentityLinkingCapability<
  SlackTargetConfig,
  Record<string, string>,
  SlackConnectionConfig
> = {
  eligibleConnectionMethodIds: [SlackConnectionMethodId],
  supportsConnection(input) {
    let clientId: string;
    try {
      clientId = resolveSlackClientIdOrThrow({
        connection: input.connection,
      });
    } catch (error) {
      if (error instanceof SlackIdentityLinkingConfigurationError) {
        return false;
      }

      throw error;
    }

    return (
      clientId.length > 0 &&
      input.availableConnectionSecretSlotKeys.has(SlackCredentialSlotKeys.CLIENT_SECRET)
    );
  },
  async startAuthorization(input) {
    const clientId = resolveSlackClientIdOrThrow({
      connection: input.connection,
    });

    try {
      await input.resolveConnectionSecret({
        slotKey: SlackCredentialSlotKeys.CLIENT_SECRET,
      });
    } catch {
      throw new SlackIdentityLinkingConfigurationError(
        `Integration connection '${input.connection.id}' is missing Slack app client secret.`,
      );
    }

    return startSlackLinkedAccountAuthorization({
      apiBaseUrl: input.target.config.apiBaseUrl,
      clientId,
      state: input.state,
      redirectUrl: input.redirectUrl,
    });
  },
  async completeAuthorization(input) {
    const clientId = resolveSlackClientIdOrThrow({
      connection: input.connection,
    });

    let clientSecret: string;
    try {
      clientSecret = await input.resolveConnectionSecret({
        slotKey: SlackCredentialSlotKeys.CLIENT_SECRET,
      });
    } catch {
      throw new SlackIdentityLinkingConfigurationError(
        `Integration connection '${input.connection.id}' is missing Slack app client secret.`,
      );
    }

    let completedAuthorization: Awaited<ReturnType<typeof completeSlackLinkedAccountAuthorization>>;
    try {
      completedAuthorization = await completeSlackLinkedAccountAuthorization({
        apiBaseUrl: input.target.config.apiBaseUrl,
        clientId,
        clientSecret,
        query: input.query,
        redirectUrl: input.redirectUrl,
        now: input.now,
      });
    } catch (error) {
      throw toSlackAuthorizationFailure({
        errorLabel: "Slack linked-account authorization",
        error,
      });
    }

    return toCompletedIdentityLinkingAuthorization(completedAuthorization);
  },
  async refreshCredential(input) {
    const clientId = resolveSlackClientIdOrThrow({
      connection: input.connection,
    });

    let clientSecret: string;
    try {
      clientSecret = await input.resolveConnectionSecret({
        slotKey: SlackCredentialSlotKeys.CLIENT_SECRET,
      });
    } catch {
      throw new SlackIdentityLinkingConfigurationError(
        `Integration connection '${input.connection.id}' is missing Slack app client secret.`,
      );
    }

    const refreshToken = await input.resolveCredentialSecret({
      secretKind: "oauth2_refresh_token",
    });

    return await refreshSlackLinkedAccountCredential({
      apiBaseUrl: input.target.config.apiBaseUrl,
      clientId,
      clientSecret,
      refreshToken,
      now: input.now,
    });
  },
  resolveWebhookActor(input) {
    return resolveSlackWebhookActorKeys(input.event);
  },
};
