import {
  integrationConnectionDeviceAuthorizationAttempts,
  IntegrationDeviceAuthorizationAttemptStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { and, eq, sql } from "drizzle-orm";

import {
  decryptDeviceAuthorizationProviderStateUtf8,
  encryptDeviceAuthorizationProviderStateUtf8,
  resolveMasterEncryptionKeyMaterial,
} from "../../lib/crypto.js";
import {
  IntegrationConnectionsNotFoundCodes,
  IntegrationDeviceAuthorizationAttemptErrorCodes,
} from "../constants.js";
import { createManagedTokenConnection } from "./create-managed-token-connection.js";
import { calculatePollAfterMs, createPollAfterTimestamp } from "./device-authorization-timing.js";
import { resolveDeviceAuthorizationCapabilityTargetOrThrow } from "./resolve-device-authorization-capability-target.js";

type DeviceAuthorizationAttemptResponse =
  | {
      attemptId: string;
      status: "pending";
      verificationUrl: string;
      userCode: string;
      expiresAt?: string;
      pollAfterMs?: number;
    }
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

function toPendingResponse(input: {
  attemptId: string;
  verificationUrl: string;
  userCode: string;
  expiresAt: string | null;
  pollAfterAt: string | null;
  now: Date;
}): DeviceAuthorizationAttemptResponse {
  const pollAfterMs = calculatePollAfterMs({
    now: input.now,
    pollAfterAt: input.pollAfterAt,
  });

  return {
    attemptId: input.attemptId,
    status: IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
    verificationUrl: input.verificationUrl,
    userCode: input.userCode,
    ...(input.expiresAt === null ? {} : { expiresAt: input.expiresAt }),
    ...(pollAfterMs === undefined ? {} : { pollAfterMs }),
  };
}

function toFailedResponse(input: {
  attemptId: string;
  errorCode: string | null;
  errorMessage: string | null;
}): DeviceAuthorizationAttemptResponse {
  if (input.errorCode === null || input.errorMessage === null) {
    throw new Error(
      `Device authorization attempt '${input.attemptId}' is failed but missing terminal error details.`,
    );
  }

  return {
    attemptId: input.attemptId,
    status: IntegrationDeviceAuthorizationAttemptStatuses.FAILED,
    error: {
      code: input.errorCode,
      message: input.errorMessage,
    },
  };
}

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

function encryptProviderState(input: {
  providerState: Record<string, unknown>;
  integrationsConfig: {
    activeMasterEncryptionKeyVersion: number;
    masterEncryptionKeys: Record<string, string>;
  };
}): string {
  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: input.integrationsConfig.activeMasterEncryptionKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });

  return encryptDeviceAuthorizationProviderStateUtf8({
    plaintext: JSON.stringify(input.providerState),
    masterKeyVersion: input.integrationsConfig.activeMasterEncryptionKeyVersion,
    masterEncryptionKeyMaterial,
  });
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

export async function getDeviceAuthorizationAttempt(
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
): Promise<DeviceAuthorizationAttemptResponse> {
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
    return toFailedResponse({
      attemptId: attempt.id,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
    });
  }

  if (attempt.status === IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED) {
    return {
      attemptId: attempt.id,
      status: IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED,
    };
  }

  const now = new Date();
  if (attempt.expiresAt !== null && new Date(attempt.expiresAt).getTime() <= now.getTime()) {
    const errorMessage = "The device authorization attempt expired before approval completed.";

    const [updatedAttempt] = await ctx.db
      .update(integrationConnectionDeviceAuthorizationAttempts)
      .set({
        status: IntegrationDeviceAuthorizationAttemptStatuses.FAILED,
        errorCode: IntegrationDeviceAuthorizationAttemptErrorCodes.DEVICE_AUTH_EXPIRED,
        errorMessage,
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
        `Failed to mark expired device authorization attempt '${input.attemptId}' as failed.`,
      );
    }

    return {
      attemptId: attempt.id,
      status: IntegrationDeviceAuthorizationAttemptStatuses.FAILED,
      error: {
        code: IntegrationDeviceAuthorizationAttemptErrorCodes.DEVICE_AUTH_EXPIRED,
        message: errorMessage,
      },
    };
  }

  if (attempt.pollAfterAt !== null && new Date(attempt.pollAfterAt).getTime() > now.getTime()) {
    return toPendingResponse({
      attemptId: attempt.id,
      verificationUrl: attempt.verificationUrl,
      userCode: attempt.userCode,
      expiresAt: attempt.expiresAt,
      pollAfterAt: attempt.pollAfterAt,
      now,
    });
  }

  const resolved = await resolveDeviceAuthorizationCapabilityTargetOrThrow(
    {
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
    },
    {
      targetKey: attempt.targetKey,
      methodId: attempt.connectionMethodId,
      invalidInputCode: "INVALID_DEVICE_AUTH_STATUS_INPUT",
    },
  );
  const providerState = parseProviderStateEncrypted({
    ciphertext: attempt.providerStateEncrypted,
    masterEncryptionKeys: ctx.integrationsConfig.masterEncryptionKeys,
  });
  const pollResult = await resolved.deviceAuthorization.pollDeviceAuthorization({
    organizationId: input.organizationId,
    targetKey: attempt.targetKey,
    target: resolved.target,
    methodId: attempt.connectionMethodId,
    providerState,
  });

  if (pollResult.status === "pending") {
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
        return toFailedResponse({
          attemptId: lockedAttempt.id,
          errorCode: lockedAttempt.errorCode,
          errorMessage: lockedAttempt.errorMessage,
        });
      }

      if (lockedAttempt.status === IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED) {
        return {
          attemptId: lockedAttempt.id,
          status: IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED,
        };
      }

      const providerStateEncrypted = encryptProviderState({
        providerState: pollResult.providerState,
        integrationsConfig: ctx.integrationsConfig,
      });
      const expiresAt = pollResult.expiresAt ?? lockedAttempt.expiresAt;
      const pollAfterAt = createPollAfterTimestamp({
        pollAfterMs: pollResult.pollAfterMs,
      });

      const [updatedAttempt] = await tx
        .update(integrationConnectionDeviceAuthorizationAttempts)
        .set({
          providerStateEncrypted,
          expiresAt,
          pollAfterAt,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(
              integrationConnectionDeviceAuthorizationAttempts.organizationId,
              input.organizationId,
            ),
            eq(integrationConnectionDeviceAuthorizationAttempts.id, input.attemptId),
          ),
        )
        .returning({
          id: integrationConnectionDeviceAuthorizationAttempts.id,
        });

      if (updatedAttempt === undefined) {
        throw new Error(
          `Failed to persist pending device authorization attempt '${input.attemptId}'.`,
        );
      }

      return {
        attemptId: lockedAttempt.id,
        status: IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
        verificationUrl: lockedAttempt.verificationUrl,
        userCode: lockedAttempt.userCode,
        ...(expiresAt === null ? {} : { expiresAt }),
        ...(pollResult.pollAfterMs === undefined ? {} : { pollAfterMs: pollResult.pollAfterMs }),
      };
    });
  }

  if (pollResult.status === "failed") {
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
        return toFailedResponse({
          attemptId: lockedAttempt.id,
          errorCode: lockedAttempt.errorCode,
          errorMessage: lockedAttempt.errorMessage,
        });
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
          status: IntegrationDeviceAuthorizationAttemptStatuses.FAILED,
          errorCode: pollResult.code,
          errorMessage: pollResult.message,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(
              integrationConnectionDeviceAuthorizationAttempts.organizationId,
              input.organizationId,
            ),
            eq(integrationConnectionDeviceAuthorizationAttempts.id, input.attemptId),
          ),
        )
        .returning({
          id: integrationConnectionDeviceAuthorizationAttempts.id,
        });

      if (updatedAttempt === undefined) {
        throw new Error(
          `Failed to mark device authorization attempt '${input.attemptId}' as failed.`,
        );
      }

      return {
        attemptId: lockedAttempt.id,
        status: IntegrationDeviceAuthorizationAttemptStatuses.FAILED,
        error: {
          code: pollResult.code,
          message: pollResult.message,
        },
      };
    });
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
      return toFailedResponse({
        attemptId: lockedAttempt.id,
        errorCode: lockedAttempt.errorCode,
        errorMessage: lockedAttempt.errorMessage,
      });
    }

    if (lockedAttempt.status === IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED) {
      return {
        attemptId: lockedAttempt.id,
        status: IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED,
      };
    }

    const createdConnection = await createManagedTokenConnection(
      {
        tx,
        integrationsConfig: ctx.integrationsConfig,
      },
      {
        organizationId: input.organizationId,
        targetKey: lockedAttempt.targetKey,
        familyId: resolved.target.familyId,
        variantId: resolved.target.variantId,
        displayName:
          lockedAttempt.displayName ?? pollResult.externalSubjectId ?? lockedAttempt.targetKey,
        connectionMethodId: lockedAttempt.connectionMethodId,
        connectionConfig: pollResult.connectionConfig,
        targetSnapshotConfig: resolved.target.config,
        accessToken: pollResult.accessToken,
        ...(pollResult.accessTokenExpiresAt === undefined
          ? {}
          : { accessTokenExpiresAt: pollResult.accessTokenExpiresAt }),
        refreshToken: pollResult.refreshToken,
        ...(pollResult.refreshTokenExpiresAt === undefined
          ? {}
          : { refreshTokenExpiresAt: pollResult.refreshTokenExpiresAt }),
        ...(pollResult.credentialMetadata === undefined
          ? {}
          : { credentialMetadata: pollResult.credentialMetadata }),
        ...(pollResult.externalSubjectId === undefined
          ? {}
          : { externalSubjectId: pollResult.externalSubjectId }),
      },
    );

    const [updatedAttempt] = await tx
      .update(integrationConnectionDeviceAuthorizationAttempts)
      .set({
        status: IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED,
        connectionId: createdConnection.id,
        completedAt: sql`now()`,
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
        `Failed to mark device authorization attempt '${input.attemptId}' as completed.`,
      );
    }

    return {
      attemptId: lockedAttempt.id,
      status: IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED,
      connectionId: createdConnection.id,
    };
  });
}
