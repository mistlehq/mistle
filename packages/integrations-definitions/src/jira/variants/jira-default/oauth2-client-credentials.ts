import type {
  IntegrationOAuth2ClientCredentialsExchangeInput,
  IntegrationOAuth2ClientCredentialsExchangeResult,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  JiraServiceAccountOauthClientCredentialsConnectionConfigSchema,
  type JiraConnectionConfig,
} from "./auth.js";

const JiraOauthTokenEndpoint = "https://auth.atlassian.com/oauth/token";

const JiraOauthTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    token_type: z.literal("Bearer"),
    scope: z.string().optional(),
  })
  .strict();

type JiraOauthTokenResponse = z.output<typeof JiraOauthTokenResponseSchema>;

export function buildJiraClientCredentialsRequestBody(input: {
  clientId: string;
  clientSecret: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("client_id", input.clientId);
  params.set("client_secret", input.clientSecret);
  params.set("grant_type", "client_credentials");
  return params;
}

export function parseJiraClientCredentialsResponse(input: unknown): JiraOauthTokenResponse {
  return JiraOauthTokenResponseSchema.parse(input);
}

export function resolveAccessTokenExpiresAt(input: {
  issuedAt: Date;
  expiresInSeconds: number;
}): string {
  return new Date(input.issuedAt.getTime() + input.expiresInSeconds * 1000).toISOString();
}

export async function exchangeJiraClientCredentials(
  input: IntegrationOAuth2ClientCredentialsExchangeInput<
    Record<string, unknown>,
    Record<string, string>,
    JiraConnectionConfig
  >,
): Promise<IntegrationOAuth2ClientCredentialsExchangeResult> {
  const parsedConnectionConfig =
    JiraServiceAccountOauthClientCredentialsConnectionConfigSchema.parse(input.connection.config);
  const requestBody = buildJiraClientCredentialsRequestBody({
    clientId: parsedConnectionConfig.client_id,
    clientSecret: input.clientSecret,
  });

  const response = await fetch(JiraOauthTokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: requestBody,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Jira OAuth2 client-credentials exchange failed (${response.status}): ${responseText}`,
    );
  }

  const parsedResponse = parseJiraClientCredentialsResponse(await response.json());

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
