import {
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
  userExternalPrincipalKeys,
  UserExternalPrincipalKeyStatuses,
  userExternalPrincipals,
  UserExternalPrincipalStatuses,
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
      principalId: userExternalPrincipals.id,
      userId: userExternalPrincipals.userId,
      keyType: userExternalPrincipalKeys.keyType,
      keyValue: userExternalPrincipalKeys.keyValue,
    })
    .from(userExternalPrincipalKeys)
    .innerJoin(
      userExternalPrincipals,
      eq(userExternalPrincipals.id, userExternalPrincipalKeys.principalId),
    )
    .innerJoin(
      organizationIdentityLinkProviderConfigs,
      and(
        eq(
          organizationIdentityLinkProviderConfigs.organizationId,
          userExternalPrincipals.organizationId,
        ),
        eq(
          organizationIdentityLinkProviderConfigs.providerFamily,
          userExternalPrincipals.providerFamily,
        ),
        eq(
          organizationIdentityLinkProviderConfigs.id,
          userExternalPrincipals.organizationProviderConfigId,
        ),
      ),
    )
    .where(
      and(
        eq(userExternalPrincipals.organizationId, input.organizationId),
        eq(userExternalPrincipals.providerFamily, input.providerFamily),
        eq(userExternalPrincipals.status, UserExternalPrincipalStatuses.ACTIVE),
        eq(
          organizationIdentityLinkProviderConfigs.integrationConnectionId,
          input.webhookConnectionId,
        ),
        eq(
          organizationIdentityLinkProviderConfigs.status,
          OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        ),
        eq(userExternalPrincipalKeys.status, UserExternalPrincipalKeyStatuses.ACTIVE),
        or(
          ...keys.map((key) =>
            and(
              eq(userExternalPrincipalKeys.keyType, key.keyType),
              eq(userExternalPrincipalKeys.keyValue, key.keyValue),
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
