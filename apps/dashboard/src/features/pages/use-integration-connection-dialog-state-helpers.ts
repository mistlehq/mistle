import type {
  IntegrationConnectionDialogState,
  IntegrationConnectionMethod,
  IntegrationConnectionMethodId,
} from "../integrations/integration-connection-dialog.js";
import type { OpenIntegrationConnectionDialogInput } from "./integration-connection-dialog-state-types.js";

export type IntegrationConnectionDialogDraft = {
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  error: string | null;
  methodId: IntegrationConnectionMethodId;
  secrets: Record<string, string>;
};

export function createClosedIntegrationConnectionDialogDraft(
  defaultMethodId: IntegrationConnectionMethodId,
): IntegrationConnectionDialogDraft {
  return {
    connectionDisplayNamePlaceholder: "",
    connectionDisplayNameValue: "",
    error: null,
    methodId: defaultMethodId,
    secrets: {},
  };
}

export function createOpenIntegrationConnectionDialogState(input: {
  openInput: OpenIntegrationConnectionDialogInput;
}): {
  dialog: IntegrationConnectionDialogState;
  draft: IntegrationConnectionDialogDraft;
} {
  const supportedMethods =
    input.openInput.mode === "create" ? input.openInput.methods : [input.openInput.currentMethod];
  const defaultMethod = supportedMethods[0];
  if (defaultMethod === undefined) {
    throw new Error(
      `Integration target '${input.openInput.targetKey}' does not declare any supported connection methods.`,
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
          currentMethod: input.openInput.currentMethod,
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
      connectionDisplayNamePlaceholder: defaultConnectionDisplayName,
      connectionDisplayNameValue: existingConnectionDisplayName ?? "",
      error: null,
      methodId: defaultMethod.id,
      secrets: {},
    },
  };
}

function resolveSupportedMethods(
  dialog: IntegrationConnectionDialogState,
): readonly IntegrationConnectionMethod[] {
  return dialog.mode === "create" ? dialog.methods : [dialog.currentMethod];
}

function resolveSelectedMethod(input: {
  dialog: IntegrationConnectionDialogState;
  methodId: IntegrationConnectionMethodId;
}): IntegrationConnectionMethod {
  const selectedMethod = resolveSupportedMethods(input.dialog).find(
    (method) => method.id === input.methodId,
  );
  if (selectedMethod === undefined) {
    throw new Error(
      `Connect method '${input.methodId}' is not supported for target '${input.dialog.targetKey}'.`,
    );
  }

  return selectedMethod;
}

export function hasIntegrationConnectionDialogChanges(input: {
  dialog: IntegrationConnectionDialogState | null;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  secrets: Record<string, string>;
}): boolean {
  if (input.dialog?.mode === "create") {
    return true;
  }

  return (
    (
      input.dialog?.initialConnectionDisplayName ?? input.connectionDisplayNamePlaceholder
    ).trim() !== input.connectionDisplayNameValue.trim() ||
    Object.values(input.secrets).some((value) => value.trim().length > 0)
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
  connectionDisplayNameValue: string;
  secrets: Record<string, string>;
}): string | null {
  const selectedMethod = resolveSelectedMethod({
    dialog: input.dialog,
    methodId: input.methodId,
  });

  const normalizedConnectionDisplayName = input.connectionDisplayNameValue.trim();
  if (normalizedConnectionDisplayName.length === 0) {
    return "Connection name is required.";
  }

  if (selectedMethod.kind !== "form") {
    return null;
  }

  if (input.dialog.mode === "create") {
    const missingSecretField = selectedMethod.secretFields.find(
      (secretField) => (input.secrets[secretField.name] ?? "").trim().length === 0,
    );

    if (missingSecretField !== undefined) {
      return `${missingSecretField.label} is required.`;
    }
  }

  return null;
}
