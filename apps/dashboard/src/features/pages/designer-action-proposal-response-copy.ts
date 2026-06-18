import type { DesignerActionProposalResponseResult } from "../designer/designer-service.js";

export function formatDesignerActionProposalResponseSuccessMessage(
  result: DesignerActionProposalResponseResult,
): string {
  const submittedAt = result.actionProposalResponse.submittedAt;
  if (result.actionRequest.status === "executing") {
    return `Action proposal response submitted at ${submittedAt}. Execution is in progress.`;
  }

  if (result.actionRequest.status === "execution_unsupported") {
    return `Action proposal response submitted at ${submittedAt}. Execution is not supported for this operation yet.`;
  }

  if (result.actionRequest.status === "failed") {
    return result.actionRequest.failureMessage === null
      ? `Action proposal response submitted at ${submittedAt}, but execution failed.`
      : `Action proposal response submitted at ${submittedAt}, but execution failed: ${result.actionRequest.failureMessage}`;
  }

  if (result.actionRequest.status === "completed") {
    const resultLabel = formatDesignerActionRequestOperationResult(
      result.actionRequest.operationResult,
    );
    return resultLabel === null
      ? `Action proposal response submitted at ${submittedAt}. Execution completed.`
      : `Action proposal response submitted at ${submittedAt}. ${resultLabel}`;
  }

  return `Action proposal response submitted at ${submittedAt}.`;
}

export function formatDesignerActionRequestOperationResult(
  result: DesignerActionProposalResponseResult["actionRequest"]["operationResult"],
): string | null {
  if (result === null) {
    return null;
  }

  switch (result.kind) {
    case "sandboxProfileDraftPublish":
      if (result.snapshotAction.kind === "created") {
        return `Published ${result.profileId} version ${String(result.version)} and queued snapshot job ${result.snapshotAction.snapshotJobId}.`;
      }

      return `Published ${result.profileId} version ${String(result.version)} using snapshot ${result.snapshotAction.snapshotImageId}.`;
    case "sandboxProfileDraftSetupScriptPut":
      return `Updated setup script for ${result.profileId} version ${String(result.version)}.`;
    case "sandboxProfileVersionLaunch":
      return `Launched sandbox session ${result.sandboxInstanceId}.`;
  }
}
