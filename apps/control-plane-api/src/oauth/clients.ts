import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  OAuthApplicationTypes,
  OAuthClientRegistrationKinds,
  OAuthClientTypes,
  OAuthGrantTypes,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";

import {
  OrganizationPermissions,
  type OrganizationPermission,
} from "../auth/services/organization-policy.js";

type StaticOAuthClientDefinition = {
  clientId: string;
  name: string;
  clientType: typeof OAuthClientTypes.PUBLIC;
  applicationType: typeof OAuthApplicationTypes.NATIVE;
  registrationKind: typeof OAuthClientRegistrationKinds.STATIC;
  redirectUris: readonly string[];
  grantTypes: readonly (
    | typeof OAuthGrantTypes.AUTHORIZATION_CODE
    | typeof OAuthGrantTypes.REFRESH_TOKEN
  )[];
  scopes: readonly OrganizationPermission[];
};

export const MistleCliOAuthClient: StaticOAuthClientDefinition = {
  clientId: "mistle-cli",
  name: "Mistle CLI",
  clientType: OAuthClientTypes.PUBLIC,
  applicationType: OAuthApplicationTypes.NATIVE,
  registrationKind: OAuthClientRegistrationKinds.STATIC,
  redirectUris: ["http://127.0.0.1/callback"],
  grantTypes: [OAuthGrantTypes.AUTHORIZATION_CODE, OAuthGrantTypes.REFRESH_TOKEN],
  scopes: [
    OrganizationPermissions.ORGANIZATION_READ,
    OrganizationPermissions.SANDBOX_PROFILE_READ,
    OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
    OrganizationPermissions.SANDBOX_SESSION_CREATE,
    OrganizationPermissions.SANDBOX_SESSION_READ,
    OrganizationPermissions.SANDBOX_SESSION_RESUME,
    OrganizationPermissions.SANDBOX_SESSION_CONNECT,
  ],
};

export async function ensureStaticOAuthClients(input: { db: ControlPlaneDatabase }): Promise<void> {
  await ensureMistleCliOAuthClient(input);
}

async function ensureMistleCliOAuthClient(input: { db: ControlPlaneDatabase }): Promise<void> {
  await input.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);
    await tx
      .insert(tables.oauthClients)
      .values({
        clientId: MistleCliOAuthClient.clientId,
        name: MistleCliOAuthClient.name,
        clientType: MistleCliOAuthClient.clientType,
        applicationType: MistleCliOAuthClient.applicationType,
        registrationKind: MistleCliOAuthClient.registrationKind,
      })
      .onConflictDoNothing({ target: tables.oauthClients.clientId });

    const client = await tx.query.oauthClients.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.clientId, MistleCliOAuthClient.clientId),
    });
    const oauthClientId = client?.id;

    if (oauthClientId === undefined) {
      throw new Error("Failed to ensure Mistle CLI OAuth client.");
    }

    await tx
      .update(tables.oauthClients)
      .set({
        name: MistleCliOAuthClient.name,
        clientType: MistleCliOAuthClient.clientType,
        applicationType: MistleCliOAuthClient.applicationType,
        registrationKind: MistleCliOAuthClient.registrationKind,
        clientSecretHash: null,
        clientSecretHashAlgorithm: null,
        disabledAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.oauthClients.id, oauthClientId));

    await tx
      .delete(tables.oauthClientGrantTypes)
      .where(eq(tables.oauthClientGrantTypes.oauthClientId, oauthClientId));
    await tx.insert(tables.oauthClientGrantTypes).values(
      MistleCliOAuthClient.grantTypes.map((grantType) => ({
        oauthClientId,
        grantType,
      })),
    );

    await tx
      .delete(tables.oauthClientRedirectUris)
      .where(eq(tables.oauthClientRedirectUris.oauthClientId, oauthClientId));
    await tx.insert(tables.oauthClientRedirectUris).values(
      MistleCliOAuthClient.redirectUris.map((redirectUri) => ({
        oauthClientId,
        redirectUri,
      })),
    );

    await tx
      .delete(tables.oauthClientScopes)
      .where(eq(tables.oauthClientScopes.oauthClientId, oauthClientId));
    await tx.insert(tables.oauthClientScopes).values(
      MistleCliOAuthClient.scopes.map((scope) => ({
        oauthClientId,
        scope,
      })),
    );
  });
}
