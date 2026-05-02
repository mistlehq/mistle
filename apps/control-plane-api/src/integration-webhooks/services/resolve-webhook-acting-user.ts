import {
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalKeyStatuses,
  UserExternalPrincipalStatuses,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type {
  AnyIntegrationDefinition,
  IdentityLinkingPrincipalKey,
  IntegrationResolvedTarget,
  IntegrationWebhookEvent,
} from "@mistle/integrations-core";
import { and, eq, or } from "drizzle-orm";

import type { AppContext } from "../../types.js";

type ResolvedWebhookActingUser = {
  principalId: string;
  userId: string;
} | null;

export async function resolveWebhookActingUser(
  {
    db,
  }: {
    db: AppContext["var"]["db"];
  },
  input: {
    organizationId: string;
    webhookConnectionId: string;
    providerFamily: string;
    definition: AnyIntegrationDefinition;
    target: IntegrationResolvedTarget<unknown, unknown>;
    event: IntegrationWebhookEvent;
  },
): Promise<ResolvedWebhookActingUser> {
  const tables = getControlPlaneDatabaseSchema(db);

  const keys =
    (await input.definition.identityLinking?.resolveWebhookActor?.({
      organizationId: input.organizationId,
      providerFamily: input.providerFamily,
      target: input.target,
      event: input.event,
    })) ?? null;
  if (keys === null) {
    return null;
  }

  const matchedKeyRows = await db
    .select({
      principalId: tables.userExternalPrincipals.id,
      userId: tables.userExternalPrincipals.userId,
      keyType: tables.userExternalPrincipalKeys.keyType,
      keyValue: tables.userExternalPrincipalKeys.keyValue,
    })
    .from(tables.userExternalPrincipalKeys)
    .innerJoin(
      tables.userExternalPrincipals,
      eq(tables.userExternalPrincipals.id, tables.userExternalPrincipalKeys.principalId),
    )
    .innerJoin(
      tables.organizationIdentityLinkProviderConfigs,
      and(
        eq(
          tables.organizationIdentityLinkProviderConfigs.organizationId,
          tables.userExternalPrincipals.organizationId,
        ),
        eq(
          tables.organizationIdentityLinkProviderConfigs.providerFamily,
          tables.userExternalPrincipals.providerFamily,
        ),
        eq(
          tables.organizationIdentityLinkProviderConfigs.id,
          tables.userExternalPrincipals.organizationProviderConfigId,
        ),
      ),
    )
    .where(
      and(
        eq(tables.userExternalPrincipals.organizationId, input.organizationId),
        eq(tables.userExternalPrincipals.providerFamily, input.providerFamily),
        eq(tables.userExternalPrincipals.status, UserExternalPrincipalStatuses.ACTIVE),
        eq(
          tables.organizationIdentityLinkProviderConfigs.integrationConnectionId,
          input.webhookConnectionId,
        ),
        eq(
          tables.organizationIdentityLinkProviderConfigs.status,
          OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        ),
        eq(tables.userExternalPrincipalKeys.status, UserExternalPrincipalKeyStatuses.ACTIVE),
        or(
          ...keys.map((key) =>
            and(
              eq(tables.userExternalPrincipalKeys.keyType, key.keyType),
              eq(tables.userExternalPrincipalKeys.keyValue, key.keyValue),
            ),
          ),
        ),
      ),
    );

  return resolveMatchedWebhookPrincipalOrThrow({
    keys,
    matchedKeyRows,
  });
}

function resolveMatchedWebhookPrincipalOrThrow(input: {
  keys: readonly [IdentityLinkingPrincipalKey, ...IdentityLinkingPrincipalKey[]];
  matchedKeyRows: ReadonlyArray<{
    principalId: string;
    userId: string;
    keyType: string;
    keyValue: string;
  }>;
}): ResolvedWebhookActingUser {
  const expectedKeys = new Set(input.keys.map((key) => toPrincipalKeyIdentity(key)));
  const matchesByPrincipalId = new Map<
    string,
    {
      userId: string;
      matchedKeys: Set<string>;
    }
  >();

  for (const matchedKeyRow of input.matchedKeyRows) {
    const existingMatch = matchesByPrincipalId.get(matchedKeyRow.principalId);
    const matchedKeyIdentity = toPrincipalKeyIdentity(matchedKeyRow);
    if (existingMatch === undefined) {
      matchesByPrincipalId.set(matchedKeyRow.principalId, {
        userId: matchedKeyRow.userId,
        matchedKeys: new Set([matchedKeyIdentity]),
      });
      continue;
    }

    existingMatch.matchedKeys.add(matchedKeyIdentity);
  }

  const fullyMatchedPrincipals = [...matchesByPrincipalId.entries()].filter(([, match]) =>
    areAllKeysMatched({
      expectedKeys,
      matchedKeys: match.matchedKeys,
    }),
  );
  if (fullyMatchedPrincipals.length === 0) {
    return null;
  }

  const firstMatch = fullyMatchedPrincipals[0];
  if (firstMatch === undefined) {
    return null;
  }
  if (fullyMatchedPrincipals[1] !== undefined) {
    throw new Error(
      `Multiple active linked principals matched webhook actor keys '${[...expectedKeys].join(", ")}'.`,
    );
  }

  return {
    principalId: firstMatch[0],
    userId: firstMatch[1].userId,
  };
}

function areAllKeysMatched(input: {
  expectedKeys: ReadonlySet<string>;
  matchedKeys: ReadonlySet<string>;
}): boolean {
  for (const expectedKey of input.expectedKeys) {
    if (!input.matchedKeys.has(expectedKey)) {
      return false;
    }
  }

  return true;
}

function toPrincipalKeyIdentity(input: { keyType: string; keyValue: string }): string {
  return `${input.keyType}\u0000${input.keyValue}`;
}
