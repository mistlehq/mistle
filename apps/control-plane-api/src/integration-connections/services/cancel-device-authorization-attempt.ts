import {
  integrationConnectionDeviceAuthorizationAttempts,
  IntegrationDeviceAuthorizationAttemptStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { and, eq, sql } from "drizzle-orm";

import { decryptDeviceAuthorizationProviderStateUtf8 } from "../../lib/crypto.js";
import { IntegrationConnectionsNotFoundCodes } from "../constants.js";
import { resolveDeviceAuthorizationCapabilityTargetOrThrow } from "./resolve-device-authorization-capability-target.js";

type CancelDeviceAuthorizationAttemptResponse =
  | {
      attemptId: string;
      status: "completed";
      connectionId: string;
    }
  | {
      attemptId: string;
      status: "failed";
      error: {
        code: string;
        message: string;
      };
    }
  | {
      attemptId: string;
      status: "cancelled";
    };

function parseProviderStateEncrypted(input: {
  ciphertext: string;
  masterEncryptionKeys: Record<string, string>;
}): Record<string, unknown> {
  const plaintext = decryptDeviceAuthorizationProviderStateUtf8({
    ciphertext: input.ciphertext,
    masterEncryptionKeys: input.masterEncryptionKeys,
  });
  const parsed = JSON.parse(plaintext);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Device authorization provider state must decode to an object.");
  }

  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    record[key] = value;
  }

  return record;
}

async function lockAttemptForUpdateOrThrow(input: {
  db: ControlPlaneDatabase | ControlPlaneTransaction;
  organizationId: string;
  attemptId: string;
}) {
  const [lockedAttempt] = await input.db
    .select()
    .from(integrationConnectionDeviceAuthorizationAttempts)
    .where(
      and(
        eq(integrationConnectionDeviceAuthorizationAttempts.organizationId, input.organizationId),
        eq(integrationConnectionDeviceAuthorizationAttempts.id, input.attemptId),
      ),
    )
    .limit(1)
    .for("update");

  if (lockedAttempt === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.DEVICE_AUTH_ATTEMPT_NOT_FOUND,
      `Device authorization attempt '${input.attemptId}' was not found.`,
    );
  }

  return lockedAttempt;
}

export async function cancelDeviceAuthorizationAttempt(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: {
    organizationId: string;
    targetKey: string;
    attemptId: string;
  },
): Promise<CancelDeviceAuthorizationAttemptResponse> {
  const attempt = await ctx.db.query.integrationConnectionDeviceAuthorizationAttempts.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.targetKey, input.targetKey),
        eq(table.id, input.attemptId),
      ),
  });

  if (attempt === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.DEVICE_AUTH_ATTEMPT_NOT_FOUND,
      `Device authorization attempt '${input.attemptId}' was not found.`,
    );
  }

  if (attempt.status === IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED) {
    if (attempt.connectionId === null) {
      throw new Error(
        `Device authorization attempt '${input.attemptId}' is completed but missing connection id.`,
      );
    }

    return {
      attemptId: attempt.id,
      status: IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED,
      connectionId: attempt.connectionId,
    };
  }

  if (attempt.status === IntegrationDeviceAuthorizationAttemptStatuses.FAILED) {
    if (attempt.errorCode === null || attempt.errorMessage === null) {
      throw new Error(
        `Device authorization attempt '${input.attemptId}' is failed but missing terminal error details.`,
      );
    }

    return {
      attemptId: attempt.id,
      status: IntegrationDeviceAuthorizationAttemptStatuses.FAILED,
      error: {
        code: attempt.errorCode,
        message: attempt.errorMessage,
      },
    };
  }

  if (attempt.status === IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED) {
    return {
      attemptId: attempt.id,
      status: IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED,
    };
  }

  try {
    const resolved = await resolveDeviceAuthorizationCapabilityTargetOrThrow(
      {
        db: ctx.db,
        integrationRegistry: ctx.integrationRegistry,
        integrationsConfig: ctx.integrationsConfig,
      },
      {
        targetKey: attempt.targetKey,
        methodId: attempt.connectionMethodId,
        invalidInputCode: "INVALID_DEVICE_AUTH_CANCEL_INPUT",
      },
    );

    if (resolved.deviceAuthorization.cancelDeviceAuthorization !== undefined) {
      const providerState = parseProviderStateEncrypted({
        ciphertext: attempt.providerStateEncrypted,
        masterEncryptionKeys: ctx.integrationsConfig.masterEncryptionKeys,
      });

      await resolved.deviceAuthorization.cancelDeviceAuthorization({
        organizationId: input.organizationId,
        targetKey: attempt.targetKey,
        target: resolved.target,
        methodId: attempt.connectionMethodId,
        providerState,
      });
    }
  } catch {
    // Cancellation is intentionally best-effort.
  }

  return ctx.db.transaction(async (tx) => {
    const lockedAttempt = await lockAttemptForUpdateOrThrow({
      db: tx,
      organizationId: input.organizationId,
      attemptId: input.attemptId,
    });

    if (lockedAttempt.status === IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED) {
      if (lockedAttempt.connectionId === null) {
        throw new Error(
          `Device authorization attempt '${input.attemptId}' is completed but missing connection id.`,
        );
      }

      return {
        attemptId: lockedAttempt.id,
        status: IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED,
        connectionId: lockedAttempt.connectionId,
      };
    }

    if (lockedAttempt.status === IntegrationDeviceAuthorizationAttemptStatuses.FAILED) {
      if (lockedAttempt.errorCode === null || lockedAttempt.errorMessage === null) {
        throw new Error(
          `Device authorization attempt '${input.attemptId}' is failed but missing terminal error details.`,
        );
      }

      return {
        attemptId: lockedAttempt.id,
        status: IntegrationDeviceAuthorizationAttemptStatuses.FAILED,
        error: {
          code: lockedAttempt.errorCode,
          message: lockedAttempt.errorMessage,
        },
      };
    }

    if (lockedAttempt.status === IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED) {
      return {
        attemptId: lockedAttempt.id,
        status: IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED,
      };
    }

    const [updatedAttempt] = await tx
      .update(integrationConnectionDeviceAuthorizationAttempts)
      .set({
        status: IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED,
        cancelledAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(integrationConnectionDeviceAuthorizationAttempts.organizationId, input.organizationId),
          eq(integrationConnectionDeviceAuthorizationAttempts.id, input.attemptId),
        ),
      )
      .returning({
        id: integrationConnectionDeviceAuthorizationAttempts.id,
      });

    if (updatedAttempt === undefined) {
      throw new Error(
        `Failed to mark device authorization attempt '${input.attemptId}' as cancelled.`,
      );
    }

    return {
      attemptId: lockedAttempt.id,
      status: IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED,
    };
  });
}
