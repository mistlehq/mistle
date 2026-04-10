import {
  integrationConnectionDeviceAuthorizationAttempts,
  IntegrationDeviceAuthorizationAttemptStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { and, eq, sql } from "drizzle-orm";

import { IntegrationConnectionsNotFoundCodes } from "../constants.js";

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

export async function cancelDeviceAuthorizationAttempt(
  ctx: {
    db: ControlPlaneDatabase;
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

  const [updatedAttempt] = await ctx.db
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
    attemptId: attempt.id,
    status: IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED,
  };
}
