import { Buffer } from "node:buffer";
import { createSign } from "node:crypto";

import {
  IntegrationCredentialResolutionError,
  type IntegrationCredentialResolver,
  type IntegrationCredentialResolverInput,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  GoogleWorkspaceAnyConnectionConfigSchema,
  GoogleWorkspaceConnectionMethodIds,
  GoogleWorkspaceCredentialSecretTypes,
  GoogleWorkspaceCredentialSlotKeys,
  GoogleWorkspaceOAuthScopes,
} from "./auth.js";
import { GoogleWorkspaceBindingConfigSchema } from "./binding-config-schema.js";

const GoogleWorkspaceDefaultTokenEndpoint = "https://oauth2.googleapis.com/token";
const GoogleWorkspaceJwtBearerGrantType = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const GoogleWorkspaceServiceAccountTokenTtlSeconds = 3600;

const GoogleWorkspaceServiceAccountKeySchema = z
  .object({
    type: z.literal("service_account"),
    client_email: z.string().email(),
    private_key: z.string().min(1),
    token_uri: z.string().url().optional(),
  })
  .loose();

const GoogleWorkspaceServiceAccountTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive().optional(),
  })
  .loose();

const GoogleWorkspaceOAuthErrorBodySchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .loose();

type GoogleWorkspaceServiceAccountKey = z.output<typeof GoogleWorkspaceServiceAccountKeySchema>;

type GoogleWorkspaceServiceAccountTokenResponse = z.output<
  typeof GoogleWorkspaceServiceAccountTokenResponseSchema
>;

type GoogleWorkspaceServiceAccountContext = {
  workspaceUserEmail: string;
  clientEmail: string;
  privateKey: string;
  tokenEndpoint: string;
};

function base64UrlEncodeUtf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function resolveGoogleWorkspaceTokenEndpoint(key: GoogleWorkspaceServiceAccountKey): string {
  return key.token_uri ?? GoogleWorkspaceDefaultTokenEndpoint;
}

export function buildGoogleWorkspaceServiceAccountJwtAssertion(input: {
  clientEmail: string;
  workspaceUserEmail: string;
  privateKey: string;
  tokenEndpoint?: string;
  issuedAtEpochSeconds: number;
}): string {
  const tokenEndpoint = input.tokenEndpoint ?? GoogleWorkspaceDefaultTokenEndpoint;
  const header = base64UrlEncodeUtf8(
    JSON.stringify({
      alg: "RS256",
      typ: "JWT",
    }),
  );
  const payload = base64UrlEncodeUtf8(
    JSON.stringify({
      iss: input.clientEmail,
      scope: GoogleWorkspaceOAuthScopes.join(" "),
      aud: tokenEndpoint,
      exp: input.issuedAtEpochSeconds + GoogleWorkspaceServiceAccountTokenTtlSeconds,
      iat: input.issuedAtEpochSeconds,
      sub: input.workspaceUserEmail,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();

  return `${signingInput}.${signer.sign(input.privateKey, "base64url")}`;
}

export function buildGoogleWorkspaceServiceAccountTokenRequestBody(input: {
  assertion: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", GoogleWorkspaceJwtBearerGrantType);
  params.set("assertion", input.assertion);

  return params;
}

function parseGoogleWorkspaceServiceAccountKey(
  rawKeyJson: string,
): GoogleWorkspaceServiceAccountKey {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawKeyJson);
  } catch (error) {
    throw new IntegrationCredentialResolutionError(
      "Google Workspace service account credential resolution failed: the service account key is not valid JSON.",
      { cause: error },
    );
  }

  return GoogleWorkspaceServiceAccountKeySchema.parse(parsedJson);
}

export function resolveGoogleWorkspaceServiceAccountContext(
  input: IntegrationCredentialResolverInput,
): GoogleWorkspaceServiceAccountContext {
  if (
    input.secretType !== GoogleWorkspaceCredentialSecretTypes.OAUTH2_ACCESS_TOKEN ||
    input.slotKey !== GoogleWorkspaceCredentialSlotKeys.accessToken
  ) {
    throw new Error(
      `Google Workspace service account resolver only supports '${GoogleWorkspaceCredentialSecretTypes.OAUTH2_ACCESS_TOKEN}' for slot '${GoogleWorkspaceCredentialSlotKeys.accessToken}'.`,
    );
  }

  const parsedConnectionConfig = GoogleWorkspaceAnyConnectionConfigSchema.parse(
    input.connection.config,
  );
  if (
    parsedConnectionConfig.connection_method !==
    GoogleWorkspaceConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION
  ) {
    throw new Error(
      "Google Workspace service account resolver requires a service-account connection config.",
    );
  }
  const parsedBindingConfig = GoogleWorkspaceBindingConfigSchema.parse(input.binding?.config);
  if (parsedBindingConfig.workspaceUserEmail === undefined) {
    throw new Error(
      "Google Workspace service account resolver requires binding config `workspaceUserEmail`.",
    );
  }

  const rawKeyJson = input.connection.secrets?.["serviceAccountKeyJson"];
  if (rawKeyJson === undefined || rawKeyJson.length === 0) {
    throw new Error(
      "Google Workspace service account resolver requires connection secret `serviceAccountKeyJson`.",
    );
  }

  const key = parseGoogleWorkspaceServiceAccountKey(rawKeyJson);

  return {
    workspaceUserEmail: parsedBindingConfig.workspaceUserEmail,
    clientEmail: key.client_email,
    privateKey: key.private_key,
    tokenEndpoint: resolveGoogleWorkspaceTokenEndpoint(key),
  };
}

export function resolveGoogleWorkspaceServiceAccountAccessToken(input: {
  response: GoogleWorkspaceServiceAccountTokenResponse;
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

function resolveGoogleWorkspaceServiceAccountTokenErrorMessage(input: {
  status: number;
  body: string;
}): string {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(input.body);
  } catch {
    return `Google Workspace service account token exchange failed with status ${input.status}: ${input.body}`;
  }

  const errorBody = GoogleWorkspaceOAuthErrorBodySchema.safeParse(parsedBody);
  if (!errorBody.success) {
    return `Google Workspace service account token exchange failed with status ${input.status}: ${input.body}`;
  }

  if (errorBody.data.error_description !== undefined) {
    return `Google Workspace service account token exchange failed with status ${input.status}: ${errorBody.data.error_description}`;
  }

  if (errorBody.data.error !== undefined) {
    return `Google Workspace service account token exchange failed with status ${input.status}: ${errorBody.data.error}`;
  }

  return `Google Workspace service account token exchange failed with status ${input.status}.`;
}

async function exchangeGoogleWorkspaceServiceAccountToken(input: {
  tokenEndpoint: string;
  assertion: string;
}): Promise<GoogleWorkspaceServiceAccountTokenResponse> {
  const response = await fetch(input.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: buildGoogleWorkspaceServiceAccountTokenRequestBody({
      assertion: input.assertion,
    }),
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new IntegrationCredentialResolutionError(
      resolveGoogleWorkspaceServiceAccountTokenErrorMessage({
        status: response.status,
        body: responseText,
      }),
    );
  }

  return GoogleWorkspaceServiceAccountTokenResponseSchema.parse(JSON.parse(responseText));
}

export const GoogleWorkspaceServiceAccountCredentialResolver: IntegrationCredentialResolver = {
  async resolve(input) {
    const context = resolveGoogleWorkspaceServiceAccountContext(input);
    const nowMs = Date.now();
    const assertion = buildGoogleWorkspaceServiceAccountJwtAssertion({
      clientEmail: context.clientEmail,
      workspaceUserEmail: context.workspaceUserEmail,
      privateKey: context.privateKey,
      tokenEndpoint: context.tokenEndpoint,
      issuedAtEpochSeconds: Math.floor(nowMs / 1000),
    });
    const tokenResponse = await exchangeGoogleWorkspaceServiceAccountToken({
      tokenEndpoint: context.tokenEndpoint,
      assertion,
    });
    const accessToken = resolveGoogleWorkspaceServiceAccountAccessToken({
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
