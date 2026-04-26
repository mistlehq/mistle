import { identityLinkRedirectSessions, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { buildUrlWithPath } from "@mistle/http";
import { BadRequestError } from "@mistle/http/errors.js";
import { and, eq, isNull, sql } from "drizzle-orm";

import {
  decryptRedirectSessionSecretUtf8,
  encryptRedirectSessionSecretUtf8,
} from "../../lib/crypto.js";
import { buildDashboardUrl } from "../../lib/dashboard-url.js";
import { IdentityLinkingBadRequestCodes } from "../constants.js";

export {
  createRedirectQueryParams,
  createRedirectSessionExpiryTimestamp,
  createRedirectState,
} from "../../integration-connections/services/redirect-flow.js";

export function buildIdentityLinkCallbackUrl(input: {
  controlPlaneBaseUrl: string;
  providerFamily: string;
}): string {
  return buildUrlWithPath(
    input.controlPlaneBaseUrl,
    `/p/identity-linking/callbacks/${encodeURIComponent(input.providerFamily)}`,
  );
}

export function buildIdentityLinkResultDashboardUrl(input: {
  dashboardBaseUrl: string;
  providerFamily: string;
  result: "success" | "failure";
  code?: string;
}): string {
  const url = new URL(buildDashboardUrl(input.dashboardBaseUrl, "/settings/account/profile"));
  url.searchParams.set("linkedAccountProvider", input.providerFamily);
  url.searchParams.set("linkedAccountResult", input.result);
  if (input.code !== undefined) {
    url.searchParams.set("linkedAccountCode", input.code);
  }
  return url.toString();
}

export function resolveRedirectStateOrThrow(query: URLSearchParams): string {
  const state = query.get("state");
  if (state === null || state.length === 0) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_CALLBACK_INPUT,
      "Identity-link callback query must include `state`.",
    );
  }

  return state;
}

export function resolveIdentityLinkRedirectSecret(
  ciphertext: string | null,
  masterEncryptionKeys: Record<string, string>,
): string | undefined {
  if (ciphertext === null) {
    return undefined;
  }

  return decryptRedirectSessionSecretUtf8({
    ciphertext,
    masterEncryptionKeys,
  });
}

export function resolveIdentityLinkProviderState(
  ciphertext: string | null,
  masterEncryptionKeys: Record<string, string>,
): Record<string, unknown> | undefined {
  const plaintext = resolveIdentityLinkRedirectSecret(ciphertext, masterEncryptionKeys);
  if (plaintext === undefined) {
    return undefined;
  }

  const parsed = JSON.parse(plaintext);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Identity-link provider state must decode to an object.");
  }

  return { ...parsed };
}

export async function persistIdentityLinkRedirectSession(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  userId: string;
  providerFamily: string;
  organizationProviderConfigId: string;
  integrationConnectionId: string;
  state: string;
  pkceVerifier?: string;
  providerState?: Record<string, unknown>;
  expiresAt: string;
  masterKeyVersion: number;
  masterEncryptionKeyMaterial: string;
}): Promise<void> {
  const pkceVerifierEncrypted =
    input.pkceVerifier === undefined
      ? undefined
      : encryptRedirectSessionSecretUtf8({
          plaintext: input.pkceVerifier,
          masterKeyVersion: input.masterKeyVersion,
          masterEncryptionKeyMaterial: input.masterEncryptionKeyMaterial,
        });
  const providerStateEncrypted =
    input.providerState === undefined
      ? undefined
      : encryptRedirectSessionSecretUtf8({
          plaintext: JSON.stringify(input.providerState),
          masterKeyVersion: input.masterKeyVersion,
          masterEncryptionKeyMaterial: input.masterEncryptionKeyMaterial,
        });

  const insertedRows = await input.db
    .insert(identityLinkRedirectSessions)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      providerFamily: input.providerFamily,
      organizationProviderConfigId: input.organizationProviderConfigId,
      integrationConnectionId: input.integrationConnectionId,
      state: input.state,
      ...(pkceVerifierEncrypted === undefined ? {} : { pkceVerifierEncrypted }),
      ...(providerStateEncrypted === undefined ? {} : { providerStateEncrypted }),
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing({
      target: identityLinkRedirectSessions.state,
    })
    .returning({
      id: identityLinkRedirectSessions.id,
    });

  if (insertedRows.length !== 1) {
    throw new Error("Failed to persist identity-link redirect session state.");
  }
}

export async function markIdentityLinkRedirectSessionUsedOrThrow(input: {
  db: ControlPlaneDatabase;
  redirectSessionId: string;
}): Promise<void> {
  const updatedRows = await input.db
    .update(identityLinkRedirectSessions)
    .set({
      usedAt: sql`now()`,
    })
    .where(
      and(
        eq(identityLinkRedirectSessions.id, input.redirectSessionId),
        isNull(identityLinkRedirectSessions.usedAt),
      ),
    )
    .returning({
      id: identityLinkRedirectSessions.id,
    });

  if (updatedRows.length !== 1) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
      "Redirect state has already been used.",
    );
  }
}
