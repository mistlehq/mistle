import type {
  IntegrationConnectionEditorState,
  IntegrationConnectionMethodId,
} from "./integration-connection-editor.js";
import type { IntegrationConnectionMethod } from "./integrations-service-shared.js";

export function resolveSelectedConnectionMethod(input: {
  editor: IntegrationConnectionEditorState;
  methodId: IntegrationConnectionMethodId;
}): IntegrationConnectionMethod | null {
  if (input.editor.mode === "update") {
    return input.editor.currentMethod.id === input.methodId ? input.editor.currentMethod : null;
  }

  return input.editor.methods.find((method) => method.id === input.methodId) ?? null;
}
