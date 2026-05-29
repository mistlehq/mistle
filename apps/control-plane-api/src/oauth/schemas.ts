import { z } from "@hono/zod-openapi";
import { OAuthGrantTypes } from "@mistle/db/control-plane";

import { ApiKeyPermissionSchema } from "../api-keys/schemas.js";

const OAuthClientRegistrationLimits = {
  CLIENT_NAME_MAX_LENGTH: 120,
  REDIRECT_URI_MAX_COUNT: 10,
  REDIRECT_URI_MAX_LENGTH: 2048,
  GRANT_TYPE_MAX_COUNT: 2,
  RESPONSE_TYPE_COUNT: 1,
  SCOPE_MAX_LENGTH: 512,
  SCOPE_MAX_COUNT: 10,
} as const;

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

export const OAuthAuthorizationConsentPayloadSchema = z
  .object({
    kind: z.literal("oauth_authorization_consent"),
    clientId: z.string().min(1),
    clientName: z.string().min(1),
    redirectUri: z.url(),
    resource: z.url(),
    codeChallenge: z.string().min(43).max(128),
    codeChallengeMethod: z.literal("S256"),
    state: z.string().min(1),
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    requestedScopes: z.array(ApiKeyPermissionSchema).min(1),
  })
  .strict();

export const OAuthConsentApprovalRequestSchema = z
  .object({
    scopes: z.array(ApiKeyPermissionSchema).min(1),
  })
  .strict();

export type OAuthAuthorizationConsentPayload = z.output<
  typeof OAuthAuthorizationConsentPayloadSchema
>;

export const OAuthClientRegistrationRequestSchema = z
  .object({
    client_name: z.string().trim().min(1).max(OAuthClientRegistrationLimits.CLIENT_NAME_MAX_LENGTH),
    redirect_uris: z
      .array(z.url().max(OAuthClientRegistrationLimits.REDIRECT_URI_MAX_LENGTH))
      .min(1)
      .max(OAuthClientRegistrationLimits.REDIRECT_URI_MAX_COUNT),
    grant_types: z
      .array(z.enum([OAuthGrantTypes.AUTHORIZATION_CODE, OAuthGrantTypes.REFRESH_TOKEN]))
      .min(1)
      .max(OAuthClientRegistrationLimits.GRANT_TYPE_MAX_COUNT),
    response_types: z
      .array(z.literal("code"))
      .length(OAuthClientRegistrationLimits.RESPONSE_TYPE_COUNT),
    scope: z.string().min(1).max(OAuthClientRegistrationLimits.SCOPE_MAX_LENGTH),
    token_endpoint_auth_method: z.literal("none"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (hasDuplicates(value.redirect_uris)) {
      ctx.addIssue({
        code: "custom",
        message: "OAuth client redirect URIs must be unique.",
        path: ["redirect_uris"],
      });
    }
    if (hasDuplicates(value.grant_types)) {
      ctx.addIssue({
        code: "custom",
        message: "OAuth client grant types must be unique.",
        path: ["grant_types"],
      });
    }

    const scopes = value.scope.split(" ").filter((scope) => scope.length > 0);
    if (scopes.length > OAuthClientRegistrationLimits.SCOPE_MAX_COUNT) {
      ctx.addIssue({
        code: "custom",
        message: "OAuth client requested too many scopes.",
        path: ["scope"],
      });
    }
    if (hasDuplicates(scopes)) {
      ctx.addIssue({
        code: "custom",
        message: "OAuth client scopes must be unique.",
        path: ["scope"],
      });
    }
  });

export const OAuthClientRegistrationResponseSchema = z
  .object({
    client_id: z.string().min(1),
    client_name: z.string().min(1),
    redirect_uris: z.array(z.url()).min(1),
    grant_types: z.array(
      z.enum([OAuthGrantTypes.AUTHORIZATION_CODE, OAuthGrantTypes.REFRESH_TOKEN]),
    ),
    response_types: z.array(z.literal("code")),
    scope: z.string().min(1),
    token_endpoint_auth_method: z.literal("none"),
    client_id_issued_at: z.number().int().nonnegative(),
  })
  .strict();

export type OAuthClientRegistrationRequest = z.output<typeof OAuthClientRegistrationRequestSchema>;
export type OAuthClientRegistrationResponse = z.output<
  typeof OAuthClientRegistrationResponseSchema
>;

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}
