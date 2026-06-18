import type { DesignerActionProposalResponseResult } from "../designer/designer-service.js";

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
