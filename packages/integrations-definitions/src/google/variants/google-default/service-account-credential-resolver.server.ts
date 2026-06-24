import { Buffer } from "node:buffer";
import { createSign } from "node:crypto";

import {
  IntegrationCredentialResolutionError,
  type IntegrationCredentialResolver,
  type IntegrationCredentialResolverInput,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  GoogleConnectionConfigSchema,
  GoogleConnectionMethodIds,
  GoogleCredentialSecretTypes,
  GoogleOAuthCredentialSlotKeys,
} from "./auth.js";
import { GoogleBindingConfigSchema } from "./binding-config-schema.js";
import { listRequiredGoogleCapabilityScopes } from "./capabilities/catalog.js";

const GoogleDefaultTokenEndpoint = "https://oauth2.googleapis.com/token";
const GoogleJwtBearerGrantType = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const GoogleServiceAccountTokenTtlSeconds = 3600;

const GoogleServiceAccountKeySchema = z
  .object({
    type: z.literal("service_account"),
    client_email: z.email(),
    private_key: z.string().min(1),
    token_uri: z.url().optional(),
  })
  .loose();

const GoogleServiceAccountTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive().optional(),
  })
  .loose();

const GoogleOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

type GoogleServiceAccountKey = z.output<typeof GoogleServiceAccountKeySchema>;

type GoogleServiceAccountTokenResponse = z.output<typeof GoogleServiceAccountTokenResponseSchema>;

type GoogleServiceAccountContext = {
  clientEmail: string;
  privateKey: string;
  scopes: readonly string[];
  tokenEndpoint: string;
};

function base64UrlEncodeUtf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function parseGoogleServiceAccountKey(rawKeyJson: string): GoogleServiceAccountKey {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawKeyJson);
  } catch (error) {
    throw new IntegrationCredentialResolutionError(
      "Google service account credential resolution failed: the service account key is not valid JSON.",
      { cause: error },
    );
  }

  return GoogleServiceAccountKeySchema.parse(parsedJson);
}

function resolveGoogleTokenEndpoint(key: GoogleServiceAccountKey): string {
  if (key.token_uri === undefined || key.token_uri === GoogleDefaultTokenEndpoint) {
    return GoogleDefaultTokenEndpoint;
  }

  throw new IntegrationCredentialResolutionError(
    "Google service account credential resolution failed: service account key token_uri must be https://oauth2.googleapis.com/token.",
  );
}

export function buildGoogleServiceAccountJwtAssertion(input: {
  clientEmail: string;
  privateKey: string;
  scopes: readonly string[];
  tokenEndpoint?: string;
  issuedAtEpochSeconds: number;
}): string {
  const tokenEndpoint = input.tokenEndpoint ?? GoogleDefaultTokenEndpoint;
  const header = base64UrlEncodeUtf8(
    JSON.stringify({
      alg: "RS256",
      typ: "JWT",
    }),
  );
  const payload = base64UrlEncodeUtf8(
    JSON.stringify({
      iss: input.clientEmail,
      scope: input.scopes.join(" "),
      aud: tokenEndpoint,
      exp: input.issuedAtEpochSeconds + GoogleServiceAccountTokenTtlSeconds,
      iat: input.issuedAtEpochSeconds,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();

  return `${signingInput}.${signer.sign(input.privateKey, "base64url")}`;
}

export function buildGoogleServiceAccountTokenRequestBody(input: {
  assertion: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", GoogleJwtBearerGrantType);
  params.set("assertion", input.assertion);

  return params;
}

export function resolveGoogleServiceAccountContext(
  input: IntegrationCredentialResolverInput,
): GoogleServiceAccountContext {
  if (
    input.secretType !== GoogleCredentialSecretTypes.OAUTH2_ACCESS_TOKEN ||
    input.slotKey !== GoogleOAuthCredentialSlotKeys.accessToken
  ) {
    throw new Error(
      `Google service account resolver only supports '${GoogleCredentialSecretTypes.OAUTH2_ACCESS_TOKEN}' for slot '${GoogleOAuthCredentialSlotKeys.accessToken}'.`,
    );
  }

  const parsedConnectionConfig = GoogleConnectionConfigSchema.parse(input.connection.config);
  if (
    parsedConnectionConfig.connection_method !== GoogleConnectionMethodIds.SERVICE_ACCOUNT &&
    parsedConnectionConfig.connection_method !==
      GoogleConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION
  ) {
    throw new Error(
      "Google service account resolver requires a service-account connection config.",
    );
  }

  const parsedBindingConfig = GoogleBindingConfigSchema.parse(input.binding?.config);
  const scopes = listRequiredGoogleCapabilityScopes(parsedBindingConfig.capabilities);
  if (scopes.length === 0) {
    throw new Error("Google service account resolver requires at least one selected capability.");
  }

  const rawKeyJson = input.connection.secrets?.["serviceAccountKeyJson"];
  if (rawKeyJson === undefined || rawKeyJson.length === 0) {
    throw new Error(
      "Google service account resolver requires connection secret `serviceAccountKeyJson`.",
    );
  }

  const key = parseGoogleServiceAccountKey(rawKeyJson);

  return {
    clientEmail: key.client_email,
    privateKey: key.private_key,
    scopes,
    tokenEndpoint: resolveGoogleTokenEndpoint(key),
  };
}

export function resolveGoogleServiceAccountAccessToken(input: {
  response: GoogleServiceAccountTokenResponse;
  nowMs: number;
}): {
  value: string;
  expiresAt?: string;
} {
  return {
    value: input.response.access_token,
    ...(input.response.expires_in === undefined
      ? {}
      : { expiresAt: new Date(input.nowMs + input.response.expires_in * 1000).toISOString() }),
  };
}

function resolveGoogleServiceAccountTokenErrorMessage(input: {
  status: number;
  body: string;
}): string {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(input.body);
  } catch {
    return `Google service account token exchange failed with status ${input.status}: ${input.body}`;
  }

  const errorBody = GoogleOAuthErrorBodySchema.safeParse(parsedBody);
  if (!errorBody.success) {
    return `Google service account token exchange failed with status ${input.status}: ${input.body}`;
  }

  if (errorBody.data.error_description !== undefined) {
    return `Google service account token exchange failed with status ${input.status}: ${errorBody.data.error_description}`;
  }

  if (errorBody.data.error !== undefined) {
    return `Google service account token exchange failed with status ${input.status}: ${errorBody.data.error}`;
  }

  return `Google service account token exchange failed with status ${input.status}.`;
}

export async function exchangeGoogleServiceAccountToken(input: {
  tokenEndpoint: string;
  assertion: string;
}): Promise<GoogleServiceAccountTokenResponse> {
  const response = await fetch(input.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: buildGoogleServiceAccountTokenRequestBody({
      assertion: input.assertion,
    }),
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new IntegrationCredentialResolutionError(
      resolveGoogleServiceAccountTokenErrorMessage({
        status: response.status,
        body: responseText,
      }),
    );
  }

  return GoogleServiceAccountTokenResponseSchema.parse(JSON.parse(responseText));
}

export const GoogleServiceAccountCredentialResolver: IntegrationCredentialResolver = {
  async resolve(input) {
    const context = resolveGoogleServiceAccountContext(input);
    const nowMs = Date.now();
    const assertion = buildGoogleServiceAccountJwtAssertion({
      clientEmail: context.clientEmail,
      privateKey: context.privateKey,
      scopes: context.scopes,
      tokenEndpoint: context.tokenEndpoint,
      issuedAtEpochSeconds: Math.floor(nowMs / 1000),
    });
    const tokenResponse = await exchangeGoogleServiceAccountToken({
      tokenEndpoint: context.tokenEndpoint,
      assertion,
    });
    const accessToken = resolveGoogleServiceAccountAccessToken({
      response: tokenResponse,
      nowMs,
    });

    return {
      kind: "value",
      value: accessToken.value,
      ...(accessToken.expiresAt === undefined ? {} : { expiresAt: accessToken.expiresAt }),
    };
  },
};
