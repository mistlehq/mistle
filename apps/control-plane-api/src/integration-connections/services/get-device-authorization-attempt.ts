import {
  integrationConnectionDeviceAuthorizationAttempts,
  IntegrationDeviceAuthorizationAttemptStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { and, eq, sql } from "drizzle-orm";

import {
  IntegrationConnectionsNotFoundCodes,
  IntegrationDeviceAuthorizationAttemptErrorCodes,
} from "../constants.js";

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

function calculatePollAfterMs(input: {
  now: Date;
  pollAfterAt: string | null;
}): number | undefined {
  if (input.pollAfterAt === null) {
    return undefined;
  }

  const pollAfterMs = new Date(input.pollAfterAt).getTime() - input.now.getTime();

  return pollAfterMs > 0 ? pollAfterMs : 0;
}

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

export async function getDeviceAuthorizationAttempt(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    organizationId: string;
    attemptId: string;
  },
): Promise<DeviceAuthorizationAttemptResponse> {
  const attempt = await ctx.db.query.integrationConnectionDeviceAuthorizationAttempts.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.organizationId, input.organizationId), eq(table.id, input.attemptId)),
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

  return toPendingResponse({
    attemptId: attempt.id,
    verificationUrl: attempt.verificationUrl,
    userCode: attempt.userCode,
    expiresAt: attempt.expiresAt,
    pollAfterAt: attempt.pollAfterAt,
    now,
  });
}
