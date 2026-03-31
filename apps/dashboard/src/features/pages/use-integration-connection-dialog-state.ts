import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type {
  IntegrationConnectionDialogState,
  IntegrationConnectionMethodId,
} from "../integrations/integration-connection-dialog.js";
import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";
import {
  createFormIntegrationConnection,
  startRedirectIntegrationConnection,
  updateFormIntegrationConnection,
  updateIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { OpenIntegrationConnectionDialogInput } from "./integration-connection-dialog-state-types.js";
import {
  createClosedIntegrationConnectionDialogDraft,
  createOpenIntegrationConnectionDialogState,
  hasIntegrationConnectionDialogChanges,
  isIntegrationConnectionDisplayNameChanged,
  resolveConnectionMethodFormUiModel,
  resolveDefaultMethodId,
  resolveIntegrationConnectionDialogValidationError,
  resolveNextDraftForMethodChange,
} from "./use-integration-connection-dialog-state-helpers.js";

function isRedirectConnectionMethodId(
  methodId: IntegrationConnectionMethodId,
): methodId is "oauth2-authorization-code" | "github-app-installation" {
  return (
    methodId === IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE ||
    methodId === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  );
}

function resolveSelectedMethod(input: {
  dialog: IntegrationConnectionDialogState;
  methodId: IntegrationConnectionMethodId;
}): IntegrationConnectionMethod | null {
  if (input.dialog.mode === "update") {
    return input.dialog.currentMethod.id === input.methodId ? input.dialog.currentMethod : null;
  }

  return input.dialog.methods.find((method) => method.id === input.methodId) ?? null;
}

export function useIntegrationConnectionDialogState(input: { queryKey: readonly unknown[] }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<IntegrationConnectionDialogState | null>(null);
  const [draft, setDraft] = useState(() =>
    createClosedIntegrationConnectionDialogDraft(IntegrationConnectionMethodIds.API_KEY),
  );

  const createFormMutation = useMutation({
    mutationFn: async (mutationInput: {
      targetKey: string;
      displayName: string;
      methodId: IntegrationConnectionMethodId;
      config: Record<string, unknown>;
      secrets: Record<string, string>;
    }) => createFormIntegrationConnection(mutationInput),
  });

  const startRedirectMutation = useMutation({
    mutationFn: async (mutationInput: {
      targetKey: string;
      methodId: "oauth2-authorization-code" | "github-app-installation";
      displayName?: string;
    }) => startRedirectIntegrationConnection(mutationInput),
  });

  const updateConnectionMetadataMutation = useMutation({
    mutationFn: async (mutationInput: { connectionId: string; displayName: string }) =>
      updateIntegrationConnection(mutationInput),
  });

  const updateFormMutation = useMutation({
    mutationFn: async (mutationInput: {
      connectionId: string;
      displayName: string;
      config: Record<string, unknown>;
      secrets?: Record<string, string>;
    }) => updateFormIntegrationConnection(mutationInput),
  });

  const configForm: ReturnType<typeof resolveConnectionMethodFormUiModel> =
    dialog === null
      ? {
          mode: "none",
        }
      : resolveConnectionMethodFormUiModel({
          dialog,
          methodId: draft.methodId,
          currentValue: draft.configValue,
        });

  function closeDialog(): void {
    setDialog(null);
    setDraft(createClosedIntegrationConnectionDialogDraft(IntegrationConnectionMethodIds.API_KEY));
  }

  function openDialog(openInput: OpenIntegrationConnectionDialogInput): void {
    const nextState = createOpenIntegrationConnectionDialogState({
      defaultMethodId:
        openInput.mode === "create"
          ? resolveDefaultMethodId(openInput.methods)
          : openInput.currentMethod.id,
      openInput,
    });
    setDialog(nextState.dialog);
    setDraft(nextState.draft);
  }

  async function runSubmit(): Promise<void> {
    if (dialog === null) {
      throw new Error("Connection dialog is required to run this action.");
    }

    const validationError = resolveIntegrationConnectionDialogValidationError({
      dialog,
      methodId: draft.methodId,
      connectionDisplayNameValue: draft.connectionDisplayNameValue,
      secrets: draft.secrets,
    });
    if (validationError !== null) {
      setDraft((currentDraft) => ({
        ...currentDraft,
        error: validationError,
      }));
      return;
    }

    const normalizedConnectionDisplayName = draft.connectionDisplayNameValue.trim();
    const selectedMethod = resolveSelectedMethod({
      dialog,
      methodId: draft.methodId,
    });

    if (selectedMethod?.kind === "form") {
      const normalizedSecrets = Object.entries(draft.secrets).reduce<Record<string, string>>(
        (accumulator, [name, value]) => {
          const trimmedValue = value.trim();
          if (trimmedValue.length > 0) {
            accumulator[name] = trimmedValue;
          }
          return accumulator;
        },
        {},
      );

      if (dialog.mode === "update") {
        await updateFormMutation.mutateAsync({
          connectionId: dialog.connectionId,
          displayName: normalizedConnectionDisplayName,
          config: draft.configValue,
          ...(Object.keys(normalizedSecrets).length === 0 ? {} : { secrets: normalizedSecrets }),
        });
      } else {
        await createFormMutation.mutateAsync({
          targetKey: dialog.targetKey,
          displayName: normalizedConnectionDisplayName,
          methodId: draft.methodId,
          config: draft.configValue,
          secrets: normalizedSecrets,
        });
      }

      await queryClient.invalidateQueries({
        queryKey: input.queryKey,
      });

      closeDialog();
      return;
    }

    if (dialog.mode === "update") {
      await updateConnectionMetadataMutation.mutateAsync({
        connectionId: dialog.connectionId,
        displayName: normalizedConnectionDisplayName,
      });

      await queryClient.invalidateQueries({
        queryKey: input.queryKey,
      });

      closeDialog();
      return;
    }

    if (!isRedirectConnectionMethodId(draft.methodId)) {
      throw new Error(`Unsupported redirect connection method '${draft.methodId}'.`);
    }

    const started = await startRedirectMutation.mutateAsync({
      targetKey: dialog.targetKey,
      methodId: draft.methodId,
      ...(normalizedConnectionDisplayName.length === 0
        ? {}
        : { displayName: normalizedConnectionDisplayName }),
    });
    globalThis.location.assign(started.authorizationUrl);
  }

  function submitDialog(): void {
    setDraft((currentDraft) => ({
      ...currentDraft,
      error: null,
    }));
    void runSubmit().catch((submitError: unknown) => {
      setDraft((currentDraft) => ({
        ...currentDraft,
        error: resolveApiErrorMessage({
          error: submitError,
          fallbackMessage:
            dialog?.mode === "update"
              ? "Could not update connection."
              : "Could not start integration connection.",
        }),
      }));
    });
  }

  return {
    configForm,
    configValue: draft.configValue,
    dialog,
    methodId: draft.methodId,
    connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
    connectionDisplayNameValue: draft.connectionDisplayNameValue,
    secrets: draft.secrets,
    error: draft.error,
    pending:
      createFormMutation.isPending ||
      startRedirectMutation.isPending ||
      updateConnectionMetadataMutation.isPending ||
      updateFormMutation.isPending,
    hasChanges: hasIntegrationConnectionDialogChanges({
      dialog,
      connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
      connectionDisplayNameValue: draft.connectionDisplayNameValue,
      configValue: draft.configValue,
      initialConfigValue: draft.initialConfigValue,
      secrets: draft.secrets,
    }),
    isSecretChanged: Object.values(draft.secrets).some((value) => value.trim().length > 0),
    isConnectionDisplayNameChanged: isIntegrationConnectionDisplayNameChanged({
      dialog,
      connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
      connectionDisplayNameValue: draft.connectionDisplayNameValue,
    }),
    openDialog,
    closeDialog,
    submitDialog,
    onConfigChange: (value: Record<string, unknown>): void => {
      setDraft((currentDraft) => ({
        ...currentDraft,
        configValue: value,
        error: null,
      }));
    },
    onSecretChange: (name: string, value: string): void => {
      setDraft((currentDraft) => ({
        ...currentDraft,
        error: null,
        secrets: {
          ...currentDraft.secrets,
          [name]: value,
        },
      }));
    },
    onConnectionDisplayNameChange: (value: string): void => {
      setDraft((currentDraft) => ({
        ...currentDraft,
        connectionDisplayNameValue: value,
        error: null,
      }));
    },
    onMethodChange: (nextMethodId: IntegrationConnectionMethodId): void => {
      if (dialog === null) {
        return;
      }

      setDraft((currentDraft) =>
        resolveNextDraftForMethodChange({
          dialog,
          nextMethodId,
          currentDraft,
        }),
      );
    },
  };
}
