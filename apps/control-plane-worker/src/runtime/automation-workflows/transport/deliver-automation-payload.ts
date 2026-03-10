import type { DeliverAutomationPayloadServiceInput } from "../../services/types.js";
import {
  connectSandboxAgentConnection,
  sendSandboxAgentMessage,
} from "./sandbox-agent-connection.js";

const AutomationRunDeliveryFailureCodes = {
  AUTOMATION_RUN_EXECUTION_FAILED: "automation_run_execution_failed",
  TEMPLATE_RENDER_FAILED: "template_render_failed",
} as const;

class AutomationRunDeliveryError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string; cause?: unknown }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}

export async function deliverAutomationPayload(
  input: DeliverAutomationPayloadServiceInput,
): Promise<void> {
  if (input.preparedAutomationRun.renderedInput.trim().length === 0) {
    throw new AutomationRunDeliveryError({
      code: AutomationRunDeliveryFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered automation input template must not be empty.",
    });
  }

  if (input.acquiredAutomationConnection.token.trim().length === 0) {
    throw new AutomationRunDeliveryError({
      code: AutomationRunDeliveryFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: "Acquired automation connection token must not be empty.",
    });
  }

  if (input.acquiredAutomationConnection.url.trim().length === 0) {
    throw new AutomationRunDeliveryError({
      code: AutomationRunDeliveryFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: "Acquired automation connection URL must not be empty.",
    });
  }

  try {
    const connection = await connectSandboxAgentConnection({
      connectionUrl: input.acquiredAutomationConnection.url,
    });
    await sendSandboxAgentMessage({
      connection,
      message: input.preparedAutomationRun.renderedInput,
    });
  } catch (error) {
    throw new AutomationRunDeliveryError({
      code: AutomationRunDeliveryFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: error instanceof Error ? error.message : "Failed to deliver automation payload.",
      cause: error,
    });
  }
}
