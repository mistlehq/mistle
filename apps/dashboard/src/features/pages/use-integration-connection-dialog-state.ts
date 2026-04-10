import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type {
  IntegrationConnectionDeviceAuthorizationPendingState,
  IntegrationConnectionDialogState,
  IntegrationConnectionMethodId,
} from "../integrations/integration-connection-dialog.js";
import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";
import {
  cancelDeviceAuthorizationAttempt,
  createFormIntegrationConnection,
  getDeviceAuthorizationAttempt,
  startDeviceAuthorizationIntegrationConnection,
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
): methodId is "oauth2-authorization-code" {
  return methodId === IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE;
}

function isDeviceAuthorizationMethod(
  method: IntegrationConnectionMethod | null,
): method is Extract<IntegrationConnectionMethod, { kind: "device-authorization" }> {
  return method?.kind === "device-authorization";
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

const DeviceAuthorizationPollFloorMs = 2_000;

export function useIntegrationConnectionDialogState(input: { queryKey: readonly unknown[] }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<IntegrationConnectionDialogState | null>(null);
  const [deviceAuthorizationPending, setDeviceAuthorizationPending] =
    useState<IntegrationConnectionDeviceAuthorizationPendingState | null>(null);
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
      methodId: "oauth2-authorization-code";
      displayName?: string;
    }) => startRedirectIntegrationConnection(mutationInput),
  });

  const startDeviceAuthorizationMutation = useMutation({
    mutationFn: async (mutationInput: {
      targetKey: string;
      methodId: IntegrationConnectionMethodId;
      displayName?: string;
    }) => startDeviceAuthorizationIntegrationConnection(mutationInput),
  });

  const cancelDeviceAuthorizationMutation = useMutation({
    mutationFn: async (mutationInput: { targetKey: string; attemptId: string }) =>
      cancelDeviceAuthorizationAttempt(mutationInput),
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
    setDeviceAuthorizationPending(null);
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
    setDeviceAuthorizationPending(null);
    setDraft(nextState.draft);
  }

  function closeDialogWithoutCancellingPendingAttempt(): void {
    setDialog(null);
    setDeviceAuthorizationPending(null);
    setDraft(createClosedIntegrationConnectionDialogDraft(IntegrationConnectionMethodIds.API_KEY));
  }

  async function cancelPendingDeviceAuthorizationAndClose(): Promise<void> {
    if (deviceAuthorizationPending === null) {
      closeDialogWithoutCancellingPendingAttempt();
      return;
    }

    await cancelDeviceAuthorizationMutation.mutateAsync({
      targetKey: deviceAuthorizationPending.targetKey,
      attemptId: deviceAuthorizationPending.attemptId,
    });

    await queryClient.invalidateQueries({
      queryKey: input.queryKey,
    });

    closeDialogWithoutCancellingPendingAttempt();
  }

  useEffect(() => {
    if (dialog === null || deviceAuthorizationPending === null) {
      return;
    }

    let disposed = false;
    const timer: TimerHandle = systemScheduler.schedule(
      () => {
        void getDeviceAuthorizationAttempt({
          targetKey: deviceAuthorizationPending.targetKey,
          attemptId: deviceAuthorizationPending.attemptId,
        })
          .then(async (attempt) => {
            if (disposed) {
              return;
            }

            if (attempt.status === "pending") {
              setDeviceAuthorizationPending((currentPending) => {
                if (
                  currentPending === null ||
                  currentPending.attemptId !== deviceAuthorizationPending.attemptId
                ) {
                  return currentPending;
                }

                return {
                  ...currentPending,
                  ...(attempt.pollAfterMs === undefined
                    ? {}
                    : { pollAfterMs: attempt.pollAfterMs }),
                  ...(attempt.expiresAt === undefined ? {} : { expiresAt: attempt.expiresAt }),
                };
              });
              return;
            }

            if (attempt.status === "completed") {
              await queryClient.invalidateQueries({
                queryKey: input.queryKey,
              });
              if (!disposed) {
                closeDialogWithoutCancellingPendingAttempt();
              }
              return;
            }

            if (attempt.status === "failed") {
              setDeviceAuthorizationPending(null);
              setDraft((currentDraft) => ({
                ...currentDraft,
                error: attempt.error.message,
              }));
              return;
            }

            setDeviceAuthorizationPending(null);
            closeDialogWithoutCancellingPendingAttempt();
          })
          .catch((pollError: unknown) => {
            if (disposed) {
              return;
            }

            setDeviceAuthorizationPending(null);
            setDraft((currentDraft) => ({
              ...currentDraft,
              error: resolveApiErrorMessage({
                error: pollError,
                fallbackMessage: "Could not read integration connection status.",
              }),
            }));
          });
      },
      Math.max(
        deviceAuthorizationPending.pollAfterMs ?? DeviceAuthorizationPollFloorMs,
        DeviceAuthorizationPollFloorMs,
      ),
    );

    return () => {
      disposed = true;
      systemScheduler.cancel(timer);
    };
  }, [deviceAuthorizationPending, dialog, input.queryKey, queryClient]);

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

    if (isDeviceAuthorizationMethod(selectedMethod)) {
      const started = await startDeviceAuthorizationMutation.mutateAsync({
        targetKey: dialog.targetKey,
        methodId: draft.methodId,
        ...(normalizedConnectionDisplayName.length === 0
          ? {}
          : { displayName: normalizedConnectionDisplayName }),
      });

      setDeviceAuthorizationPending({
        targetKey: dialog.targetKey,
        attemptId: started.attemptId,
        verificationUrl: started.verificationUrl,
        userCode: started.userCode,
        method: selectedMethod,
        ...(started.pollAfterMs === undefined ? {} : { pollAfterMs: started.pollAfterMs }),
        ...(started.expiresAt === undefined ? {} : { expiresAt: started.expiresAt }),
      });
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
    deviceAuthorizationPending,
    pending:
      createFormMutation.isPending ||
      startDeviceAuthorizationMutation.isPending ||
      startRedirectMutation.isPending ||
      cancelDeviceAuthorizationMutation.isPending ||
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
    closeDialog: (): void => {
      if (deviceAuthorizationPending !== null) {
        void cancelPendingDeviceAuthorizationAndClose().catch((cancelError: unknown) => {
          setDraft((currentDraft) => ({
            ...currentDraft,
            error: resolveApiErrorMessage({
              error: cancelError,
              fallbackMessage: "Could not cancel integration connection.",
            }),
          }));
        });
        return;
      }

      closeDialog();
    },
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
