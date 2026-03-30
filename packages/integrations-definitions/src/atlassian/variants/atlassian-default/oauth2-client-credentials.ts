import type {
  IntegrationOAuth2ClientCredentialsExchangeInput,
  IntegrationOAuth2ClientCredentialsExchangeResult,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  AtlassianServiceAccountOauthClientCredentialsConnectionConfigSchema,
  type AtlassianConnectionConfig,
} from "./auth.js";

const AtlassianOauthTokenEndpoint = "https://auth.atlassian.com/oauth/token";

const AtlassianOauthTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    token_type: z.literal("Bearer"),
    scope: z.string().optional(),
  })
  .strict();

type AtlassianOauthTokenResponse = z.output<typeof AtlassianOauthTokenResponseSchema>;

export function buildAtlassianClientCredentialsRequestBody(input: {
  clientId: string;
  clientSecret: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("client_id", input.clientId);
  params.set("client_secret", input.clientSecret);
  params.set("grant_type", "client_credentials");
  return params;
}

export function parseAtlassianClientCredentialsResponse(
  input: unknown,
): AtlassianOauthTokenResponse {
  return AtlassianOauthTokenResponseSchema.parse(input);
}

export function resolveAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresInSeconds: number;
}): string {
  return new Date(input.issuedAt.getTime() + input.expiresInSeconds * 1000).toISOString();
}

export async function exchangeAtlassianClientCredentials(
  input: IntegrationOAuth2ClientCredentialsExchangeInput<
    Record<string, unknown>,
    Record<string, string>,
    AtlassianConnectionConfig
  >,
): Promise<IntegrationOAuth2ClientCredentialsExchangeResult> {
  const parsedConnectionConfig =
    AtlassianServiceAccountOauthClientCredentialsConnectionConfigSchema.parse(
      input.connection.config,
    );
  const requestBody = buildAtlassianClientCredentialsRequestBody({
    clientId: parsedConnectionConfig.client_id,
    clientSecret: input.clientSecret,
  });

  const response = await fetch(AtlassianOauthTokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: requestBody,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Atlassian OAuth2 client-credentials exchange failed (${response.status}): ${responseText}`,
    );
  }

  const parsedResponse = parseAtlassianClientCredentialsResponse(await response.json());

  return {
    accessToken: parsedResponse.access_token,
    accessTokenExpiresAt: resolveAccessTokenExpiresAt({
      issuedAt: new Date(),
      expiresInSeconds: parsedResponse.expires_in,
    }),
    ...(parsedResponse.scope === undefined
      ? {}
      : {
          credentialMetadata: {
            scope: parsedResponse.scope,
          },
        }),
  };
}
