import type {
  IntegrationConnectionDialogState,
  IntegrationConnectionMethodId,
} from "../integrations/integration-connection-dialog.js";
import type { OpenIntegrationConnectionDialogInput } from "./integration-connection-dialog-state-types.js";

export type IntegrationConnectionDialogDraft = {
  apiKeyValue: string;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  error: string | null;
  methodId: IntegrationConnectionMethodId;
};

export function createClosedIntegrationConnectionDialogDraft(
  defaultMethodId: IntegrationConnectionMethodId,
): IntegrationConnectionDialogDraft {
  return {
    apiKeyValue: "",
    connectionDisplayNamePlaceholder: "",
    connectionDisplayNameValue: "",
    error: null,
    methodId: defaultMethodId,
  };
}

export function createOpenIntegrationConnectionDialogState(input: {
  defaultMethodId: IntegrationConnectionMethodId;
  openInput: OpenIntegrationConnectionDialogInput;
}): {
  dialog: IntegrationConnectionDialogState;
  draft: IntegrationConnectionDialogDraft;
} {
  const supportedMethods =
    input.openInput.mode === "create" ? input.openInput.methods : [input.openInput.currentMethodId];
  const defaultMethod = supportedMethods[0];
  if (defaultMethod === undefined) {
    throw new Error(
      `Integration target '${input.openInput.targetKey}' does not declare any supported auth scheme.`,
    );
  }

  const existingConnectionDisplayName =
    input.openInput.mode === "update" ? input.openInput.connectionDisplayName : undefined;
  const defaultConnectionDisplayName =
    input.openInput.mode === "update"
      ? (existingConnectionDisplayName ?? input.openInput.connectionId ?? "")
      : `${input.openInput.targetDisplayName} connection`;

  const dialog: IntegrationConnectionDialogState =
    input.openInput.mode === "create"
      ? {
          targetKey: input.openInput.targetKey,
          displayName: input.openInput.targetDisplayName,
          mode: input.openInput.mode,
          methods: input.openInput.methods,
        }
      : {
          connectionId: input.openInput.connectionId,
          currentMethodId: input.openInput.currentMethodId,
          targetKey: input.openInput.targetKey,
          displayName: input.openInput.targetDisplayName,
          mode: input.openInput.mode,
          ...(existingConnectionDisplayName === undefined
            ? {}
            : { initialConnectionDisplayName: existingConnectionDisplayName }),
        };

  return {
    dialog,
    draft: {
      apiKeyValue: "",
      connectionDisplayNamePlaceholder: defaultConnectionDisplayName,
      connectionDisplayNameValue: existingConnectionDisplayName ?? "",
      error: null,
      methodId: defaultMethod ?? input.defaultMethodId,
    },
  };
}

export function hasIntegrationConnectionDialogChanges(input: {
  dialog: IntegrationConnectionDialogState | null;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  apiKeyValue: string;
}): boolean {
  if (input.dialog?.mode === "create") {
    return true;
  }

  return (
    (
      input.dialog?.initialConnectionDisplayName ?? input.connectionDisplayNamePlaceholder
    ).trim() !== input.connectionDisplayNameValue.trim() || input.apiKeyValue.trim().length > 0
  );
}

export function isIntegrationConnectionDisplayNameChanged(input: {
  dialog: IntegrationConnectionDialogState | null;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
}): boolean {
  if (input.dialog?.mode !== "update") {
    return input.connectionDisplayNameValue.trim().length > 0;
  }

  return (
    (input.dialog.initialConnectionDisplayName ?? input.connectionDisplayNamePlaceholder).trim() !==
    input.connectionDisplayNameValue.trim()
  );
}

export function resolveIntegrationConnectionDialogValidationError(input: {
  dialog: IntegrationConnectionDialogState;
  methodId: IntegrationConnectionMethodId;
  apiKeyValue: string;
  connectionDisplayNameValue: string;
}): string | null {
  const supportedMethods =
    input.dialog.mode === "create" ? input.dialog.methods : [input.dialog.currentMethodId];
  if (!supportedMethods.includes(input.methodId)) {
    throw new Error(
      `Connect method '${input.methodId}' is not supported for target '${input.dialog.targetKey}'.`,
    );
  }

  const normalizedConnectionDisplayName = input.connectionDisplayNameValue.trim();
  if (normalizedConnectionDisplayName.length === 0) {
    return "Connection name is required.";
  }

  if (input.methodId !== "api-key") {
    return null;
  }

  if (input.dialog.mode === "create" && input.apiKeyValue.trim().length === 0) {
    return "API key is required.";
  }

  return null;
}
