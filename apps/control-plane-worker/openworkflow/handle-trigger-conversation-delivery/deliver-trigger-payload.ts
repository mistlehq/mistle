import type { EnsuredTriggerSandbox, PreparedTriggerRun } from "../shared/trigger-run-types.js";
import {
  connectSandboxAgentConnection,
  sendSandboxAgentMessage,
} from "./sandbox-agent-connection.js";
import type { AcquiredTriggerConnection } from "./types.js";

type DeliverTriggerPayloadInput = {
  preparedTriggerRun: PreparedTriggerRun;
  ensuredTriggerSandbox?: EnsuredTriggerSandbox;
  acquiredTriggerConnection: AcquiredTriggerConnection;
};

const TriggerRunDeliveryFailureCodes = {
  TRIGGER_RUN_EXECUTION_FAILED: "trigger_run_execution_failed",
  TEMPLATE_RENDER_FAILED: "template_render_failed",
} as const;

class TriggerRunDeliveryError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string; cause?: unknown }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}

export async function deliverTriggerPayload(input: DeliverTriggerPayloadInput): Promise<void> {
  if (input.preparedTriggerRun.renderedInput.trim().length === 0) {
    throw new TriggerRunDeliveryError({
      code: TriggerRunDeliveryFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered trigger input template must not be empty.",
    });
  }

  if (input.acquiredTriggerConnection.token.trim().length === 0) {
    throw new TriggerRunDeliveryError({
      code: TriggerRunDeliveryFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: "Acquired trigger connection token must not be empty.",
    });
  }

  if (input.acquiredTriggerConnection.url.trim().length === 0) {
    throw new TriggerRunDeliveryError({
      code: TriggerRunDeliveryFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: "Acquired trigger connection URL must not be empty.",
    });
  }

  try {
    const connection = await connectSandboxAgentConnection({
      connectionUrl: input.acquiredTriggerConnection.url,
    });
    await sendSandboxAgentMessage({
      connection,
      message: input.preparedTriggerRun.renderedInput,
    });
  } catch (error) {
    throw new TriggerRunDeliveryError({
      code: TriggerRunDeliveryFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: error instanceof Error ? error.message : "Failed to deliver trigger payload.",
      cause: error,
    });
  }
}
