import type {
  IntegrationConnectionEditorState,
  IntegrationConnectionMethodId,
} from "../integrations/integration-connection-editor.js";
import { resolveSelectedConnectionMethod } from "../integrations/integration-connection-method-selection.js";
import { resolveDraftThenSetupMethodSetupFlow } from "./integration-connection-setup-state.js";

export function resolveDraftThenSetupConnectionPath(input: {
  connectionId: string | null;
  editor: IntegrationConnectionEditorState;
  methodId: IntegrationConnectionMethodId;
}): string | null {
  if (input.connectionId === null) {
    return null;
  }

  const method = resolveSelectedConnectionMethod({
    editor: input.editor,
    methodId: input.methodId,
  });

  const setupFlow = resolveDraftThenSetupMethodSetupFlow({
    method: method ?? undefined,
    methodId: input.methodId,
  });
  if (setupFlow === null) {
    return null;
  }

  return `/integrations/${encodeURIComponent(input.editor.targetKey)}/${encodeURIComponent(
    input.connectionId,
  )}/${setupFlow.routeSegment}/setup`;
}
