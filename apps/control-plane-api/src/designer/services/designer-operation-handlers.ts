import {
  type DesignerActionRequestOperation,
  DesignerActionRequestStatuses,
  type DesignerActionRequestStatus,
} from "@mistle/db/control-plane";

type DesignerOperationHandlerInput = {
  actionRequestId: string;
  organizationId: string;
  sessionId: string;
  proposalId: string;
  operation: DesignerActionRequestOperation;
};

type DesignerOperationHandlerResult = {
  status: DesignerActionRequestStatus;
  failureCode: string | null;
  failureMessage: string | null;
};

type DesignerOperationHandler = (
  input: DesignerOperationHandlerInput,
) => Promise<DesignerOperationHandlerResult>;

const DesignerOperationHandlers: Partial<
  Record<DesignerActionRequestOperation["kind"], DesignerOperationHandler>
> = {};

export async function executeApprovedDesignerOperation(
  input: DesignerOperationHandlerInput,
): Promise<DesignerOperationHandlerResult> {
  const handler = DesignerOperationHandlers[input.operation.kind];
  if (handler === undefined) {
    return {
      status: DesignerActionRequestStatuses.EXECUTION_UNSUPPORTED,
      failureCode: "DESIGNER_OPERATION_HANDLER_UNSUPPORTED",
      failureMessage: `Designer operation kind '${input.operation.kind}' does not have an execution handler.`,
    };
  }

  return handler(input);
}
