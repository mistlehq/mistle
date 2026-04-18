import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type {
  IntegrationConnectionDeviceAuthorizationPendingState,
  IntegrationConnectionEditorState,
  IntegrationConnectionMethodId,
} from "../integrations/integration-connection-editor.js";
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
import type { OpenIntegrationConnectionEditorInput } from "./integration-connection-editor-state-types.js";
import {
  createInitialIntegrationConnectionEditorState,
  hasIntegrationConnectionEditorChanges,
  isIntegrationConnectionDisplayNameChanged,
  resolveConnectionMethodFormUiModel,
  resolveDefaultMethodId,
  resolveIntegrationConnectionEditorValidationError,
  resolveNextDraftForMethodChange,
} from "./use-integration-connection-editor-state-helpers.js";

type IntegrationConnectionSubmitSuccessInput = {
  connectionId: string | null;
  editor: IntegrationConnectionEditorState;
};

type UseIntegrationConnectionEditorStateInput = {
  initialEditorInput: OpenIntegrationConnectionEditorInput;
  onClose?: () => void | Promise<void>;
  onSubmitSuccess?: (input: IntegrationConnectionSubmitSuccessInput) => void | Promise<void>;
  queryKey: readonly unknown[];
  scheduler?: Scheduler;
};

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

function resolveEditableConfigValue(input: {
  configValue: Record<string, unknown>;
  configForm: ReturnType<typeof resolveConnectionMethodFormUiModel>;
}): Record<string, unknown> | undefined {
  if (input.configForm.mode !== "form") {
    return undefined;
  }

  const entries = input.configForm.visiblePropertyKeys.flatMap((propertyKey) => {
    const value = input.configValue[propertyKey];
    return value === undefined ? [] : [[propertyKey, value] as const];
  });

  return Object.fromEntries(entries);
}

function resolveSelectedMethod(input: {
  editor: IntegrationConnectionEditorState;
  methodId: IntegrationConnectionMethodId;
}): IntegrationConnectionMethod | null {
  if (input.editor.mode === "update") {
    return input.editor.currentMethod.id === input.methodId ? input.editor.currentMethod : null;
  }

  return input.editor.methods.find((method) => method.id === input.methodId) ?? null;
}

const DeviceAuthorizationPollFloorMs = 2_000;

export function useIntegrationConnectionEditorState(
  input: UseIntegrationConnectionEditorStateInput,
) {
  const scheduler = input.scheduler ?? systemScheduler;
  const queryClient = useQueryClient();
  const initialState = createInitialIntegrationConnectionEditorState({
    defaultMethodId:
      input.initialEditorInput.mode === "create"
        ? resolveDefaultMethodId(input.initialEditorInput.methods)
        : input.initialEditorInput.currentMethod.id,
    initialEditorInput: input.initialEditorInput,
  });
  const editor = initialState.editor;
  const [deviceAuthorizationPending, setDeviceAuthorizationPending] =
    useState<IntegrationConnectionDeviceAuthorizationPendingState | null>(null);
  const [draft, setDraft] = useState(() => initialState.draft);

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
      config?: Record<string, unknown>;
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

  const updateConnectionMutation = useMutation({
    mutationFn: async (mutationInput: {
      connectionId: string;
      displayName: string;
      config?: Record<string, unknown>;
    }) => updateIntegrationConnection(mutationInput),
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
    resolveConnectionMethodFormUiModel({
      editor,
      methodId: draft.methodId,
      currentValue: draft.configValue,
    });
  const submitPending =
    createFormMutation.isPending ||
    startDeviceAuthorizationMutation.isPending ||
    startRedirectMutation.isPending ||
    updateConnectionMutation.isPending ||
    updateFormMutation.isPending;
  const closePending = submitPending || cancelDeviceAuthorizationMutation.isPending;

  function closeEditor(): void {
    if (closePending) {
      return;
    }

    setDeviceAuthorizationPending(null);
    void input.onClose?.();
  }

  function closeEditorWithoutCancellingPendingAttempt(): void {
    setDeviceAuthorizationPending(null);
  }

  async function cancelPendingDeviceAuthorizationAndClose(): Promise<void> {
    if (deviceAuthorizationPending === null) {
      closeEditorWithoutCancellingPendingAttempt();
      return;
    }

    await cancelDeviceAuthorizationMutation.mutateAsync({
      targetKey: deviceAuthorizationPending.targetKey,
      attemptId: deviceAuthorizationPending.attemptId,
    });

    await queryClient.invalidateQueries({
      queryKey: input.queryKey,
    });

    closeEditorWithoutCancellingPendingAttempt();
    void input.onClose?.();
  }

  async function handleSubmitSuccess(
    successInput: IntegrationConnectionSubmitSuccessInput,
  ): Promise<void> {
    closeEditorWithoutCancellingPendingAttempt();

    if (input.onSubmitSuccess !== undefined) {
      await input.onSubmitSuccess(successInput);
    }
  }

  useEffect(() => {
    if (deviceAuthorizationPending === null) {
      return;
    }

    let disposed = false;
    const timer: TimerHandle = scheduler.schedule(
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
                await handleSubmitSuccess({
                  connectionId: null,
                  editor,
                });
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
            closeEditorWithoutCancellingPendingAttempt();
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
      scheduler.cancel(timer);
    };
  }, [deviceAuthorizationPending, editor, input.queryKey, queryClient, scheduler]);

  async function runSubmit(): Promise<void> {
    const validationError = resolveIntegrationConnectionEditorValidationError({
      editor,
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
      editor,
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

      if (editor.mode === "update") {
        const updatedConnection = await updateFormMutation.mutateAsync({
          connectionId: editor.connectionId,
          displayName: normalizedConnectionDisplayName,
          config: draft.configValue,
          ...(Object.keys(normalizedSecrets).length === 0 ? {} : { secrets: normalizedSecrets }),
        });

        await queryClient.invalidateQueries({
          queryKey: input.queryKey,
        });

        await handleSubmitSuccess({
          connectionId: updatedConnection.id,
          editor,
        });
        return;
      } else {
        const createdConnection = await createFormMutation.mutateAsync({
          targetKey: editor.targetKey,
          displayName: normalizedConnectionDisplayName,
          methodId: draft.methodId,
          config: draft.configValue,
          secrets: normalizedSecrets,
        });

        await queryClient.invalidateQueries({
          queryKey: input.queryKey,
        });

        await handleSubmitSuccess({
          connectionId: createdConnection.id,
          editor,
        });
        return;
      }
    }

    if (editor.mode === "update") {
      const editableConfigValue = resolveEditableConfigValue({
        configValue: draft.configValue,
        configForm,
      });
      const updatedConnection = await updateConnectionMutation.mutateAsync({
        connectionId: editor.connectionId,
        displayName: normalizedConnectionDisplayName,
        ...(editableConfigValue === undefined ? {} : { config: editableConfigValue }),
      });

      await queryClient.invalidateQueries({
        queryKey: input.queryKey,
      });

      await handleSubmitSuccess({
        connectionId: updatedConnection.id,
        editor,
      });
      return;
    }

    if (isDeviceAuthorizationMethod(selectedMethod)) {
      const started = await startDeviceAuthorizationMutation.mutateAsync({
        targetKey: editor.targetKey,
        methodId: draft.methodId,
        ...(normalizedConnectionDisplayName.length === 0
          ? {}
          : { displayName: normalizedConnectionDisplayName }),
      });

      setDeviceAuthorizationPending({
        targetKey: editor.targetKey,
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
      targetKey: editor.targetKey,
      methodId: draft.methodId,
      ...(Object.keys(draft.configValue).length === 0 ? {} : { config: draft.configValue }),
      ...(normalizedConnectionDisplayName.length === 0
        ? {}
        : { displayName: normalizedConnectionDisplayName }),
    });
    globalThis.location.assign(started.authorizationUrl);
  }

  function submitEditor(): void {
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
            editor.mode === "update"
              ? "Could not update connection."
              : "Could not start integration connection.",
        }),
      }));
    });
  }

  return {
    configForm,
    configValue: draft.configValue,
    editor,
    methodId: draft.methodId,
    connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
    connectionDisplayNameValue: draft.connectionDisplayNameValue,
    secrets: draft.secrets,
    error: draft.error,
    deviceAuthorizationPending,
    pending: submitPending,
    closeDisabled: closePending,
    hasChanges: hasIntegrationConnectionEditorChanges({
      editor,
      connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
      connectionDisplayNameValue: draft.connectionDisplayNameValue,
      configValue: draft.configValue,
      initialConfigValue: draft.initialConfigValue,
      secrets: draft.secrets,
    }),
    isSecretChanged: Object.values(draft.secrets).some((value) => value.trim().length > 0),
    isConnectionDisplayNameChanged: isIntegrationConnectionDisplayNameChanged({
      editor,
      connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
      connectionDisplayNameValue: draft.connectionDisplayNameValue,
    }),
    closeEditor: (): void => {
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

      closeEditor();
    },
    submitEditor,
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
      setDraft((currentDraft) =>
        resolveNextDraftForMethodChange({
          editor,
          nextMethodId,
          currentDraft,
        }),
      );
    },
  };
}
