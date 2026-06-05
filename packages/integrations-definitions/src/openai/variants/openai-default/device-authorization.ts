import type {
  IntegrationDeviceAuthorizationCapability,
  IntegrationDeviceAuthorizationPollResult,
  IntegrationOAuth2AuthorizationCodeCapability,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification,
} from "@mistle/integrations-core";
import {
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  assertOpenAiChatGptDeviceCodeConnectionConfig,
  type OpenAiConnectionConfig,
} from "./auth.js";
import { OpenAiConnectionMethodIds } from "./model-capabilities.js";
import type { OpenAiApiKeyTargetConfig } from "./target-config-schema.js";

const OpenAiAuthIssuer = "https://auth.openai.com";
const OpenAiDeviceAuthorizationClientId = "app_EMoamEEZ73f0CkXaXp7hrann";

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const OpenAiDeviceAuthorizationStartResponseSchema = z
  .object({
    device_auth_id: z.string().min(1),
    user_code: z.string().min(1).optional(),
    usercode: z.string().min(1).optional(),
    interval: StringOrNumberSchema,
    expires_at: z.string().min(1).optional(),
  })
  .strict();

const OpenAiDeviceAuthorizationPollSuccessSchema = z
  .object({
    authorization_code: z.string().min(1),
    code_verifier: z.string().min(1),
  })
  .loose();

const OpenAiTokenExchangeResponseSchema = z
  .object({
    id_token: z.string().min(1),
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_in: StringOrNumberSchema.optional(),
  })
  .loose();

const OpenAiRefreshResponseSchema = z
  .object({
    id_token: z.string().min(1).optional(),
    access_token: z.string().min(1).optional(),
    refresh_token: z.string().min(1).optional(),
    expires_in: StringOrNumberSchema.optional(),
  })
  .loose();

const OpenAiDeviceAuthorizationProviderStateSchema = z
  .object({
    deviceAuthId: z.string().min(1),
    userCode: z.string().min(1),
    intervalSeconds: z.number().int().min(1),
  })
  .strict();

type OpenAiDeviceAuthorizationProviderState = z.infer<
  typeof OpenAiDeviceAuthorizationProviderStateSchema
>;

type OpenAiJwtClaims = Record<string, unknown>;

const OpenAiAccountIdClaim = "chatgpt_account_id";
const OpenAiPlanTypeClaim = "chatgpt_plan_type";
const OpenAiNamespacedAccountIdClaim = "https://api.openai.com/auth.chatgpt_account_id";
const OpenAiNamespacedPlanTypeClaim = "https://api.openai.com/auth.chatgpt_plan_type";
const OpenAiAuthClaimsContainerKey = "https://api.openai.com/auth";

function parsePositiveInteger(input: string | number): number {
  const value = typeof input === "number" ? input : Number(input.trim());
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Expected a positive integer value, received '${String(input)}'.`);
  }

  return value;
}

function resolveOpenAiAuthBaseUrl(targetConfig: OpenAiApiKeyTargetConfig): string {
  const authBaseUrl = targetConfig.authBaseUrl ?? OpenAiAuthIssuer;
  return authBaseUrl.endsWith("/") ? authBaseUrl.slice(0, -1) : authBaseUrl;
}

function resolveOpenAiDeviceAuthorizationApiBaseUrl(authBaseUrl: string): string {
  return `${authBaseUrl}/api/accounts/deviceauth`;
}

function resolveOpenAiDeviceAuthorizationVerificationUrl(authBaseUrl: string): string {
  return `${authBaseUrl}/codex/device`;
}

function resolveOpenAiDeviceAuthorizationRedirectUri(authBaseUrl: string): string {
  return `${authBaseUrl}/deviceauth/callback`;
}

export function parseJwtClaimsOrThrow(token: string): OpenAiJwtClaims {
  const [, encodedPayload] = token.split(".");
  if (encodedPayload === undefined) {
    throw new Error("JWT must include a payload segment.");
  }

  const payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  const parsedPayload = JSON.parse(payload);
  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    throw new Error("JWT payload must decode to an object.");
  }

  const claims: OpenAiJwtClaims = {};
  for (const [key, value] of Object.entries(parsedPayload)) {
    claims[key] = value;
  }

  return claims;
}

function resolveIsoTimestampFromExpiresIn(input: {
  expiresIn: string | number;
  nowMs: number;
}): string {
  const expiresInSeconds = parsePositiveInteger(input.expiresIn);
  return new Date(input.nowMs + expiresInSeconds * 1_000).toISOString();
}

export function resolveOpenAiAccessTokenExpiresAt(input: {
  accessToken: string;
  expiresIn?: string | number;
  nowMs: number;
}): string | undefined {
  if (input.expiresIn !== undefined) {
    return resolveIsoTimestampFromExpiresIn({
      expiresIn: input.expiresIn,
      nowMs: input.nowMs,
    });
  }

  let claims: OpenAiJwtClaims;
  try {
    claims = parseJwtClaimsOrThrow(input.accessToken);
  } catch {
    return undefined;
  }

  const expiresAtSeconds = claims["exp"];
  if (typeof expiresAtSeconds !== "number" || !Number.isInteger(expiresAtSeconds)) {
    return undefined;
  }
  if (expiresAtSeconds <= 0) {
    return undefined;
  }

  return new Date(expiresAtSeconds * 1_000).toISOString();
}

type OpenAiRefreshFailure = {
  classification: IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification;
  message: string;
  code?: string;
};

export function extractOpenAiRefreshFailureCode(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }

  const parsedBody = JSON.parse(body);
  if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
    return undefined;
  }

  const error = parsedBody["error"];
  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return undefined;
  }

  const nestedCode = error["code"];
  if (typeof nestedCode === "string" && nestedCode.length > 0) {
    return nestedCode;
  }

  return undefined;
}

function extractOpenAiRefreshFailureMessage(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }

  const parsedBody = JSON.parse(body);
  if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
    return undefined;
  }

  const errorDescription = parsedBody["error_description"];
  if (typeof errorDescription === "string" && errorDescription.length > 0) {
    return errorDescription;
  }

  const error = parsedBody["error"];
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return undefined;
  }

  const nestedMessage = error["message"];
  if (typeof nestedMessage === "string" && nestedMessage.length > 0) {
    return nestedMessage;
  }

  return undefined;
}

export function classifyOpenAiRefreshFailure(input: {
  status: number;
  body: string;
}): OpenAiRefreshFailure {
  const code = (() => {
    try {
      return extractOpenAiRefreshFailureCode(input.body);
    } catch {
      return undefined;
    }
  })();
  const messageFromBody = (() => {
    try {
      return extractOpenAiRefreshFailureMessage(input.body);
    } catch {
      return undefined;
    }
  })();

  if (input.status === 401) {
    if (code === "refresh_token_expired") {
      return {
        classification:
          IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
        message: messageFromBody ?? "OpenAI refresh token expired. Reconnect the integration.",
        code,
      };
    }

    if (code === "refresh_token_reused") {
      return {
        classification:
          IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
        message:
          messageFromBody ?? "OpenAI refresh token was already used. Reconnect the integration.",
        code,
      };
    }

    if (code === "refresh_token_invalidated" || code === "invalid_grant") {
      return {
        classification:
          IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
        message: messageFromBody ?? "OpenAI refresh token was revoked. Reconnect the integration.",
        code,
      };
    }

    return {
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
      message:
        messageFromBody ?? "OpenAI access token could not be refreshed. Reconnect the integration.",
      ...(code === undefined ? {} : { code }),
    };
  }

  return {
    classification:
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    message:
      messageFromBody ?? `OpenAI access token refresh failed with status ${String(input.status)}.`,
    ...(code === undefined ? {} : { code }),
  };
}

export function parseOpenAiTokenExchangeResponse(input: unknown): {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn?: string | number;
} {
  const parsed = OpenAiTokenExchangeResponseSchema.parse(input);

  return {
    idToken: parsed.id_token,
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    ...(parsed.expires_in === undefined ? {} : { expiresIn: parsed.expires_in }),
  };
}

export function parseOpenAiRefreshResponse(
  input: unknown,
): z.infer<typeof OpenAiRefreshResponseSchema> {
  return OpenAiRefreshResponseSchema.parse(input);
}

function resolveNestedOpenAiAuthClaims(input: OpenAiJwtClaims): OpenAiJwtClaims | undefined {
  const authClaims = input[OpenAiAuthClaimsContainerKey];
  if (typeof authClaims !== "object" || authClaims === null || Array.isArray(authClaims)) {
    return undefined;
  }

  const claims: OpenAiJwtClaims = {};
  for (const [key, value] of Object.entries(authClaims)) {
    claims[key] = value;
  }

  return claims;
}

function resolveOpenAiAccountMetadataFromClaims(input: OpenAiJwtClaims): {
  chatGptAccountId?: string;
  chatGptPlanType?: string;
} {
  const nestedClaims = resolveNestedOpenAiAuthClaims(input);
  const rawAccountId =
    input[OpenAiAccountIdClaim] ??
    input[OpenAiNamespacedAccountIdClaim] ??
    nestedClaims?.[OpenAiAccountIdClaim];
  const rawPlanType =
    input[OpenAiPlanTypeClaim] ??
    input[OpenAiNamespacedPlanTypeClaim] ??
    nestedClaims?.[OpenAiPlanTypeClaim];

  return {
    ...(typeof rawAccountId === "string" && rawAccountId.length > 0
      ? { chatGptAccountId: rawAccountId }
      : {}),
    ...(typeof rawPlanType === "string" && rawPlanType.length > 0
      ? { chatGptPlanType: rawPlanType }
      : {}),
  };
}

function resolveOpenAiRefreshResult(input: {
  response: z.infer<typeof OpenAiRefreshResponseSchema>;
}): IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult {
  if (input.response.access_token === undefined) {
    throw new Error("OpenAI refresh response is missing access_token.");
  }

  const idTokenClaims =
    input.response.id_token === undefined
      ? undefined
      : parseJwtClaimsOrThrow(input.response.id_token);
  const accessTokenExpiresAt = resolveOpenAiAccessTokenExpiresAt({
    accessToken: input.response.access_token,
    ...(input.response.expires_in === undefined ? {} : { expiresIn: input.response.expires_in }),
    nowMs: Date.now(),
  });
  const refreshToken = input.response.refresh_token;
  const accountMetadata =
    idTokenClaims === undefined ? {} : resolveOpenAiAccountMetadataFromClaims(idTokenClaims);

  return {
    accessToken: input.response.access_token,
    ...(accessTokenExpiresAt === undefined ? {} : { accessTokenExpiresAt }),
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(accountMetadata.chatGptAccountId === undefined &&
    accountMetadata.chatGptPlanType === undefined
      ? {}
      : {
          credentialMetadata: {
            ...(accountMetadata.chatGptAccountId === undefined
              ? {}
              : { chatgpt_account_id: accountMetadata.chatGptAccountId }),
            ...(accountMetadata.chatGptPlanType === undefined
              ? {}
              : { chatgpt_plan_type: accountMetadata.chatGptPlanType }),
          },
        }),
  };
}

export function resolveOpenAiDeviceAuthorizationCompletionFromTokens(input: {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt?: string;
}): Extract<
  IntegrationDeviceAuthorizationPollResult<OpenAiConnectionConfig>,
  { status: "completed" }
> {
  const idTokenClaims = parseJwtClaimsOrThrow(input.idToken);
  const accountMetadata = resolveOpenAiAccountMetadataFromClaims(idTokenClaims);
  const email = idTokenClaims["email"];
  const chatGptPlanType = accountMetadata.chatGptPlanType;

  return {
    status: "completed",
    ...(typeof email === "string" && email.length > 0 ? { externalSubjectId: email } : {}),
    connectionConfig: {
      connection_method: OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE,
      auth_mode: "chatgpt",
      ...(accountMetadata.chatGptAccountId === undefined
        ? {}
        : { chatgpt_account_id: accountMetadata.chatGptAccountId }),
      ...(chatGptPlanType === undefined ? {} : { chatgpt_plan_type: chatGptPlanType }),
    },
    accessToken: input.accessToken,
    ...(input.accessTokenExpiresAt === undefined
      ? {}
      : { accessTokenExpiresAt: input.accessTokenExpiresAt }),
    refreshToken: input.refreshToken,
  };
}

async function requestOpenAiDeviceAuthorizationStart(input: { authBaseUrl: string }): Promise<{
  verificationUrl: string;
  userCode: string;
  intervalSeconds: number;
  expiresAt?: string;
  providerState: OpenAiDeviceAuthorizationProviderState;
}> {
  const response = await fetch(
    `${resolveOpenAiDeviceAuthorizationApiBaseUrl(input.authBaseUrl)}/usercode`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        client_id: OpenAiDeviceAuthorizationClientId,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `OpenAI device authorization start failed with status ${String(response.status)}.`,
    );
  }

  const parsed = OpenAiDeviceAuthorizationStartResponseSchema.parse(await response.json());
  const userCode = parsed.user_code ?? parsed.usercode;
  if (userCode === undefined) {
    throw new Error("OpenAI device authorization start response is missing user code.");
  }

  const intervalSeconds = parsePositiveInteger(parsed.interval);

  return {
    verificationUrl: resolveOpenAiDeviceAuthorizationVerificationUrl(input.authBaseUrl),
    userCode,
    intervalSeconds,
    ...(parsed.expires_at === undefined ? {} : { expiresAt: parsed.expires_at }),
    providerState: {
      deviceAuthId: parsed.device_auth_id,
      userCode,
      intervalSeconds,
    },
  };
}

async function exchangeAuthorizationCodeForTokens(input: {
  authBaseUrl: string;
  authorizationCode: string;
  codeVerifier: string;
}): Promise<{
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn?: string | number;
}> {
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", input.authorizationCode);
  form.set("redirect_uri", resolveOpenAiDeviceAuthorizationRedirectUri(input.authBaseUrl));
  form.set("client_id", OpenAiDeviceAuthorizationClientId);
  form.set("code_verifier", input.codeVerifier);

  const response = await fetch(`${input.authBaseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!response.ok) {
    throw new Error(`OpenAI token exchange failed with status ${String(response.status)}.`);
  }

  return parseOpenAiTokenExchangeResponse(await response.json());
}

async function refreshOpenAiAccessToken(input: {
  authBaseUrl: string;
  refreshToken: string;
}): Promise<IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult> {
  const response = await fetch(`${input.authBaseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: OpenAiDeviceAuthorizationClientId,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    }),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    const failure = classifyOpenAiRefreshFailure({
      status: response.status,
      body: responseBody,
    });

    throw new IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError({
      message: failure.message,
      classification: failure.classification,
      ...(failure.code === undefined ? {} : { code: failure.code }),
    });
  }

  const parsed = parseOpenAiRefreshResponse(await response.json());
  return resolveOpenAiRefreshResult({
    response: parsed,
  });
}

async function pollOpenAiDeviceAuthorization(
  authBaseUrl: string,
  providerState: OpenAiDeviceAuthorizationProviderState,
): Promise<IntegrationDeviceAuthorizationPollResult<OpenAiConnectionConfig>> {
  const response = await fetch(`${resolveOpenAiDeviceAuthorizationApiBaseUrl(authBaseUrl)}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      device_auth_id: providerState.deviceAuthId,
      user_code: providerState.userCode,
    }),
  });

  if (response.status === 403 || response.status === 404) {
    return {
      status: "pending",
      providerState,
      pollAfterMs: providerState.intervalSeconds * 1_000,
    };
  }

  if (!response.ok) {
    return {
      status: "failed",
      code: "OPENAI_DEVICE_AUTH_FAILED",
      message: `OpenAI device authorization failed with status ${String(response.status)}.`,
      permanent: true,
    };
  }

  const authorizationCodeGrant = OpenAiDeviceAuthorizationPollSuccessSchema.parse(
    await response.json(),
  );
  const tokens = await exchangeAuthorizationCodeForTokens({
    authBaseUrl,
    authorizationCode: authorizationCodeGrant.authorization_code,
    codeVerifier: authorizationCodeGrant.code_verifier,
  });
  const accessTokenExpiresAt = resolveOpenAiAccessTokenExpiresAt({
    accessToken: tokens.accessToken,
    ...(tokens.expiresIn === undefined ? {} : { expiresIn: tokens.expiresIn }),
    nowMs: Date.now(),
  });

  return resolveOpenAiDeviceAuthorizationCompletionFromTokens({
    idToken: tokens.idToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    ...(accessTokenExpiresAt === undefined ? {} : { accessTokenExpiresAt }),
  });
}

export const OpenAiDeviceAuthorizationCapability: IntegrationDeviceAuthorizationCapability<
  OpenAiApiKeyTargetConfig,
  Record<string, string>,
  OpenAiConnectionConfig
> = {
  async startDeviceAuthorization(input) {
    if (input.methodId !== OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE) {
      throw new Error(`Unsupported OpenAI device authorization method '${input.methodId}'.`);
    }

    const startedAuthorization = await requestOpenAiDeviceAuthorizationStart({
      authBaseUrl: resolveOpenAiAuthBaseUrl(input.target.config),
    });

    return {
      verificationUrl: startedAuthorization.verificationUrl,
      userCode: startedAuthorization.userCode,
      ...(startedAuthorization.expiresAt === undefined
        ? {}
        : { expiresAt: startedAuthorization.expiresAt }),
      pollAfterMs: startedAuthorization.intervalSeconds * 1_000,
      providerState: startedAuthorization.providerState,
    };
  },

  async pollDeviceAuthorization(input) {
    if (input.methodId !== OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE) {
      throw new Error(`Unsupported OpenAI device authorization method '${input.methodId}'.`);
    }

    const providerState = OpenAiDeviceAuthorizationProviderStateSchema.parse(input.providerState);
    return pollOpenAiDeviceAuthorization(
      resolveOpenAiAuthBaseUrl(input.target.config),
      providerState,
    );
  },
};

export const OpenAiDeviceAuthorizationOAuth2Capability: IntegrationOAuth2AuthorizationCodeCapability<
  OpenAiApiKeyTargetConfig,
  Record<string, string>,
  OpenAiConnectionConfig
> = {
  async startAuthorization() {
    throw new Error(
      "OpenAI ChatGPT device-code connections do not support redirect-based authorization start.",
    );
  },

  async completeAuthorizationCodeGrant() {
    throw new Error(
      "OpenAI ChatGPT device-code connections do not support redirect-based authorization completion.",
    );
  },

  async refreshAccessToken(input) {
    assertOpenAiChatGptDeviceCodeConnectionConfig(input.connection.config);
    return refreshOpenAiAccessToken({
      authBaseUrl: resolveOpenAiAuthBaseUrl(input.target.config),
      refreshToken: input.refreshToken,
    });
  },
};
