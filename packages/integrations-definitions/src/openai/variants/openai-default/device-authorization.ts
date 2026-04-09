import type {
  IntegrationDeviceAuthorizationCapability,
  IntegrationDeviceAuthorizationPollResult,
} from "@mistle/integrations-core";
import { z } from "zod";

import type { OpenAiConnectionConfig } from "./auth.js";
import { OpenAiConnectionMethodIds } from "./model-capabilities.js";
import type { OpenAiApiKeyTargetConfig } from "./target-config-schema.js";

const OpenAiAuthIssuer = "https://auth.openai.com";
const OpenAiDeviceAuthorizationApiBaseUrl = `${OpenAiAuthIssuer}/api/accounts/deviceauth`;
const OpenAiDeviceAuthorizationVerificationUrl = `${OpenAiAuthIssuer}/codex/device`;
const OpenAiDeviceAuthorizationClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const OpenAiDeviceAuthorizationRedirectUri = `${OpenAiAuthIssuer}/deviceauth/callback`;

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
  })
  .strict();

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

const OpenAiAccountIdClaim = "https://api.openai.com/auth.chatgpt_account_id";
const OpenAiPlanTypeClaim = "https://api.openai.com/auth.chatgpt_plan_type";

function parsePositiveInteger(input: string | number): number {
  const value = typeof input === "number" ? input : Number(input.trim());
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Expected a positive integer value, received '${String(input)}'.`);
  }

  return value;
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

function resolveIsoTimestampFromExpClaim(claims: OpenAiJwtClaims): string | undefined {
  const exp = claims["exp"];
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    return undefined;
  }

  return new Date(exp * 1_000).toISOString();
}

export function resolveOpenAiDeviceAuthorizationCompletionFromTokens(input: {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}): Extract<
  IntegrationDeviceAuthorizationPollResult<OpenAiConnectionConfig>,
  { status: "completed" }
> {
  const idTokenClaims = parseJwtClaimsOrThrow(input.idToken);
  const accessTokenClaims = parseJwtClaimsOrThrow(input.accessToken);
  const refreshTokenClaims = parseJwtClaimsOrThrow(input.refreshToken);
  const accessTokenExpiresAt = resolveIsoTimestampFromExpClaim(accessTokenClaims);
  const refreshTokenExpiresAt = resolveIsoTimestampFromExpClaim(refreshTokenClaims);
  const chatGptAccountId = idTokenClaims[OpenAiAccountIdClaim];

  if (typeof chatGptAccountId !== "string" || chatGptAccountId.length === 0) {
    throw new Error(`OpenAI id_token is missing ${OpenAiAccountIdClaim}.`);
  }

  const email = idTokenClaims["email"];
  const chatGptPlanType =
    typeof idTokenClaims[OpenAiPlanTypeClaim] === "string"
      ? idTokenClaims[OpenAiPlanTypeClaim]
      : typeof accessTokenClaims[OpenAiPlanTypeClaim] === "string"
        ? accessTokenClaims[OpenAiPlanTypeClaim]
        : undefined;

  return {
    status: "completed",
    ...(typeof email === "string" && email.length > 0 ? { externalSubjectId: email } : {}),
    connectionConfig: {
      connection_method: OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE,
      auth_mode: "chatgpt",
      chatgpt_account_id: chatGptAccountId,
      ...(chatGptPlanType === undefined ? {} : { chatgpt_plan_type: chatGptPlanType }),
    },
    accessToken: input.accessToken,
    ...(accessTokenExpiresAt === undefined ? {} : { accessTokenExpiresAt }),
    refreshToken: input.refreshToken,
    ...(refreshTokenExpiresAt === undefined ? {} : { refreshTokenExpiresAt }),
  };
}

async function requestOpenAiDeviceAuthorizationStart(): Promise<{
  verificationUrl: string;
  userCode: string;
  intervalSeconds: number;
  expiresAt?: string;
  providerState: OpenAiDeviceAuthorizationProviderState;
}> {
  const response = await fetch(`${OpenAiDeviceAuthorizationApiBaseUrl}/usercode`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: OpenAiDeviceAuthorizationClientId,
    }),
  });

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
    verificationUrl: OpenAiDeviceAuthorizationVerificationUrl,
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
  authorizationCode: string;
  codeVerifier: string;
}): Promise<{
  idToken: string;
  accessToken: string;
  refreshToken: string;
}> {
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", input.authorizationCode);
  form.set("redirect_uri", OpenAiDeviceAuthorizationRedirectUri);
  form.set("client_id", OpenAiDeviceAuthorizationClientId);
  form.set("code_verifier", input.codeVerifier);

  const response = await fetch(`${OpenAiAuthIssuer}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!response.ok) {
    throw new Error(`OpenAI token exchange failed with status ${String(response.status)}.`);
  }

  const parsed = OpenAiTokenExchangeResponseSchema.parse(await response.json());
  return {
    idToken: parsed.id_token,
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
  };
}

async function pollOpenAiDeviceAuthorization(
  providerState: OpenAiDeviceAuthorizationProviderState,
): Promise<IntegrationDeviceAuthorizationPollResult<OpenAiConnectionConfig>> {
  const response = await fetch(`${OpenAiDeviceAuthorizationApiBaseUrl}/token`, {
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
    authorizationCode: authorizationCodeGrant.authorization_code,
    codeVerifier: authorizationCodeGrant.code_verifier,
  });

  return resolveOpenAiDeviceAuthorizationCompletionFromTokens({
    idToken: tokens.idToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
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

    const startedAuthorization = await requestOpenAiDeviceAuthorizationStart();

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
    return pollOpenAiDeviceAuthorization(providerState);
  },
};
