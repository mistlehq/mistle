import { z } from "@hono/zod-openapi";

import { ApiKeyPermissionSchema } from "../api-keys/schemas.js";

export const OAuthAuthorizeQuerySchema = z
  .object({
    response_type: z.literal("code"),
    client_id: z.string().min(1),
    redirect_uri: z.url(),
    resource: z.url(),
    state: z.string().min(1),
    code_challenge: z.string().min(43).max(128),
    code_challenge_method: z.literal("S256"),
    scope: z.string().min(1).optional(),
  })
  .strict();

export const OAuthAuthorizationCodeTokenRequestSchema = z
  .object({
    grant_type: z.literal("authorization_code"),
    client_id: z.string().min(1),
    redirect_uri: z.url(),
    resource: z.url(),
    code: z.string().min(1),
    code_verifier: z.string().min(43).max(128),
  })
  .strict();

export const OAuthRefreshTokenRequestSchema = z
  .object({
    grant_type: z.literal("refresh_token"),
    client_id: z.string().min(1),
    resource: z.url(),
    refresh_token: z.string().min(1),
  })
  .strict();

export const OAuthTokenRequestSchema = z.union([
  OAuthAuthorizationCodeTokenRequestSchema,
  OAuthRefreshTokenRequestSchema,
]);

export const OAuthTokenResponseSchema = z
  .object({
    token_type: z.literal("Bearer"),
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    scope: z.string().min(1),
  })
  .strict();

export const OAuthErrorResponseSchema = z
  .object({
    error: z.string().min(1),
    error_description: z.string().min(1).optional(),
  })
  .strict();

export const OAuthAuthorizationCodePayloadSchema = z
  .object({
    kind: z.literal("mistle_cli_authorization_code"),
    clientId: z.string().min(1),
    redirectUri: z.url(),
    resource: z.url(),
    codeChallenge: z.string().min(43).max(128),
    codeChallengeMethod: z.literal("S256"),
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    permissions: z.array(ApiKeyPermissionSchema).min(1),
  })
  .strict();

export type OAuthAuthorizationCodePayload = z.output<typeof OAuthAuthorizationCodePayloadSchema>;
