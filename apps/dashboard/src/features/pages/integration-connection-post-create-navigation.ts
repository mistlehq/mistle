import type {
  IntegrationConnectionEditorState,
  IntegrationConnectionMethodId,
} from "../integrations/integration-connection-editor.js";
import { resolveSelectedConnectionMethod } from "../integrations/integration-connection-method-selection.js";

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

  if (method?.kind !== "form" || method.createBehavior !== "draft-then-setup") {
    return null;
  }

  if (method.setupFlow === undefined) {
    throw new Error(
      `Draft-then-setup connection method '${input.methodId}' is missing setupFlow metadata.`,
    );
  }

  return `/integrations/${encodeURIComponent(input.editor.targetKey)}/${encodeURIComponent(
    input.connectionId,
  )}/${method.setupFlow.routeSegment}/setup`;
}
