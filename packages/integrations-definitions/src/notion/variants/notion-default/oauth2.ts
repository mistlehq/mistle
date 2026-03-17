import {
  IntegrationOAuth2RefreshAccessTokenError,
  IntegrationOAuth2RefreshAccessTokenErrorClassifications,
  type IntegrationOAuth2Capability,
} from "@mistle/integrations-core";
import { z } from "zod";

import type { NotionConnectionConfig } from "./auth.js";
import type { NotionTargetConfig } from "./target-config-schema.js";
import type { NotionTargetSecrets } from "./target-secret-schema.js";

const NotionOAuthOwner = "user";

const NotionTokenEndpointSuccessSchema = z.looseObject({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  bot_id: z.string().min(1).optional(),
  workspace_id: z.string().min(1).optional(),
  workspace_name: z.string().min(1).nullable().optional(),
  refresh_token: z.string().min(1).nullable().optional(),
});

const NotionTokenEndpointErrorSchema = z.looseObject({
  error: z.string().min(1).optional(),
  error_description: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
});

type NotionTokenEndpointSuccess = z.output<typeof NotionTokenEndpointSuccessSchema>;

class NotionTokenEndpointError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(input: { message: string; status: number; code?: string }) {
    super(input.message);
    this.name = "NotionTokenEndpointError";
    this.status = input.status;
    this.code = input.code;
  }
}

export function buildNotionAuthorizationUrl(input: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUrl: string;
  state: string;
}): string {
  const authorizationUrl = new URL(input.authorizationEndpoint);
  authorizationUrl.searchParams.set("owner", NotionOAuthOwner);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", input.clientId);
  authorizationUrl.searchParams.set("redirect_uri", input.redirectUrl);
  authorizationUrl.searchParams.set("state", input.state);
  return authorizationUrl.toString();
}

export function classifyNotionTokenEndpointFailure(input: {
  status: number;
  code?: string;
}): "temporary" | "permanent" {
  if (input.status === 429 || input.status >= 500 || input.code === "rate_limited") {
    return IntegrationOAuth2RefreshAccessTokenErrorClassifications.TEMPORARY;
  }

  return IntegrationOAuth2RefreshAccessTokenErrorClassifications.PERMANENT;
}

export function parseNotionTokenEndpointBody(input: { body: unknown }): NotionTokenEndpointSuccess {
  return NotionTokenEndpointSuccessSchema.parse(input.body);
}

function resolveAuthorizationCodeOrThrow(query: URLSearchParams): string {
  const authorizationError = query.get("error");
  if (authorizationError !== null) {
    const errorDescription = query.get("error_description");
    throw new Error(
      errorDescription === null
        ? `Notion OAuth authorization failed with '${authorizationError}'.`
        : `Notion OAuth authorization failed with '${authorizationError}': ${errorDescription}`,
    );
  }

  const authorizationCode = query.get("code");
  if (authorizationCode === null || authorizationCode.length === 0) {
    throw new Error("Notion OAuth callback is missing `code`.");
  }

  return authorizationCode;
}

function encodeBasicAuthorizationHeader(input: { clientId: string; clientSecret: string }): string {
  return `Basic ${btoa(`${input.clientId}:${input.clientSecret}`)}`;
}

async function exchangeNotionToken(input: {
  endpoint: string;
  notionVersion: string;
  clientId: string;
  clientSecret: string;
  body: Record<string, string>;
}): Promise<NotionTokenEndpointSuccess> {
  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      authorization: encodeBasicAuthorizationHeader({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      }),
      "content-type": "application/json",
      accept: "application/json",
      "Notion-Version": input.notionVersion,
    },
    body: JSON.stringify(input.body),
  });

  const responseBody = (await response.json()) as unknown;

  if (!response.ok) {
    const parsedError = NotionTokenEndpointErrorSchema.safeParse(responseBody);
    const errorCode =
      parsedError.success === false ? undefined : (parsedError.data.error ?? parsedError.data.code);
    const errorMessage =
      parsedError.success === false
        ? `Notion token request failed with HTTP ${String(response.status)}.`
        : (parsedError.data.error_description ??
          parsedError.data.message ??
          `Notion token request failed with HTTP ${String(response.status)}.`);

    throw new NotionTokenEndpointError({
      message: errorMessage,
      status: response.status,
      ...(errorCode === undefined ? {} : { code: errorCode }),
    });
  }

  return parseNotionTokenEndpointBody({
    body: responseBody,
  });
}

function resolveRefreshTokenOrThrow(response: NotionTokenEndpointSuccess): string {
  if (response.refresh_token === undefined || response.refresh_token === null) {
    throw new Error("Notion OAuth token response did not include a refresh token.");
  }

  return response.refresh_token;
}

function resolveWorkspaceIdOrThrow(response: NotionTokenEndpointSuccess): string {
  if (response.workspace_id === undefined) {
    throw new Error("Notion OAuth token response did not include `workspace_id`.");
  }

  return response.workspace_id;
}

function resolveBotIdOrThrow(response: NotionTokenEndpointSuccess): string {
  if (response.bot_id === undefined) {
    throw new Error("Notion OAuth token response did not include `bot_id`.");
  }

  return response.bot_id;
}

export const NotionOAuth2Capability: IntegrationOAuth2Capability<
  NotionTargetConfig,
  NotionTargetSecrets,
  NotionConnectionConfig
> = {
  async startAuthorization(input) {
    return {
      authorizationUrl: buildNotionAuthorizationUrl({
        authorizationEndpoint: input.target.config.authorizationEndpoint,
        clientId: input.target.secrets.clientId,
        redirectUrl: input.redirectUrl,
        state: input.state,
      }),
    };
  },
  async completeAuthorizationCodeGrant(input) {
    const authorizationCode = resolveAuthorizationCodeOrThrow(input.query);
    const tokenResponse = await exchangeNotionToken({
      endpoint: input.target.config.tokenEndpoint,
      notionVersion: input.target.config.notionVersion,
      clientId: input.target.secrets.clientId,
      clientSecret: input.target.secrets.clientSecret,
      body: {
        grant_type: "authorization_code",
        code: authorizationCode,
        redirect_uri: input.redirectUrl,
      },
    });
    const workspaceId = resolveWorkspaceIdOrThrow(tokenResponse);
    const botId = resolveBotIdOrThrow(tokenResponse);

    return {
      externalSubjectId: botId,
      connectionConfig: {
        workspace_id: workspaceId,
        ...(tokenResponse.workspace_name === undefined || tokenResponse.workspace_name === null
          ? {}
          : { workspace_name: tokenResponse.workspace_name }),
      },
      accessToken: tokenResponse.access_token,
      refreshToken: resolveRefreshTokenOrThrow(tokenResponse),
      credentialMetadata: {
        bot_id: botId,
        workspace_id: workspaceId,
        ...(tokenResponse.workspace_name === undefined || tokenResponse.workspace_name === null
          ? {}
          : { workspace_name: tokenResponse.workspace_name }),
      },
    };
  },
  async refreshAccessToken(input) {
    try {
      const tokenResponse = await exchangeNotionToken({
        endpoint: input.target.config.tokenEndpoint,
        notionVersion: input.target.config.notionVersion,
        clientId: input.target.secrets.clientId,
        clientSecret: input.target.secrets.clientSecret,
        body: {
          grant_type: "refresh_token",
          refresh_token: input.refreshToken,
        },
      });

      return {
        accessToken: tokenResponse.access_token,
        ...(tokenResponse.refresh_token === undefined || tokenResponse.refresh_token === null
          ? {}
          : { refreshToken: tokenResponse.refresh_token }),
      };
    } catch (error) {
      if (error instanceof NotionTokenEndpointError) {
        throw new IntegrationOAuth2RefreshAccessTokenError({
          message: error.message,
          classification: classifyNotionTokenEndpointFailure({
            status: error.status,
            ...(error.code === undefined ? {} : { code: error.code }),
          }),
          ...(error.code === undefined ? {} : { code: error.code }),
        });
      }

      throw new IntegrationOAuth2RefreshAccessTokenError({
        message: error instanceof Error ? error.message : "Notion token refresh failed.",
        classification: IntegrationOAuth2RefreshAccessTokenErrorClassifications.TEMPORARY,
      });
    }
  },
};
