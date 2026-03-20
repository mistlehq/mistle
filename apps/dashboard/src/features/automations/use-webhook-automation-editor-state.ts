import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useWebhookAutomationPrerequisites } from "./use-webhook-automation-prerequisites.js";
import {
  toCreateWebhookAutomationPayload,
  toUpdateWebhookAutomationPayload,
  toWebhookAutomationFormValues,
  validateWebhookAutomationFormValues,
} from "./webhook-automation-form-helpers.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationFormValues,
} from "./webhook-automation-form.js";
import { resolveConversationKeyFieldOptions } from "./webhook-automation-form.js";
import {
  buildWebhookAutomationEventOptions,
  createWebhookAutomationTriggerId,
} from "./webhook-automation-list-helpers.js";
import { resolveSelectedWebhookAutomationEventOptions } from "./webhook-automation-trigger-picker.js";
import {
  AUTOMATIONS_QUERY_KEY_PREFIX,
  webhookAutomationDetailQueryKey,
} from "./webhook-automations-query-keys.js";
import {
  createWebhookAutomation,
  deleteWebhookAutomation,
  getWebhookAutomation,
  updateWebhookAutomation,
} from "./webhook-automations-service.js";

type NavigateFunction = (to: string) => void | Promise<void>;

type UseWebhookAutomationEditorStateInput = {
  mode: "create" | "edit";
  automationId: string | undefined;
  navigate: NavigateFunction;
};

function newWebhookAutomationDetailQueryKey(): readonly [
  "automations",
  "webhooks",
  "detail",
  "new",
] {
  return ["automations", "webhooks", "detail", "new"];
}

type KeyedValue<T> = {
  sourceKey: string;
  value: T;
};

function resolveNormalizedConversationKeyTemplate(input: {
  values: WebhookAutomationFormValues;
  eventOptions: readonly WebhookAutomationEventOption[];
}): string {
  const selectedTriggerOptions = resolveSelectedWebhookAutomationEventOptions({
    eventOptions: input.eventOptions,
    selectedTriggerIds: input.values.triggerIds,
  });
  const conversationKeyFieldOptions = resolveConversationKeyFieldOptions({
    selectedEventOptions: selectedTriggerOptions,
    currentTemplate: input.values.conversationKeyTemplate,
  });

  if (conversationKeyFieldOptions.supportedOptions.length === 0) {
    return input.values.conversationKeyTemplate;
  }

  if (conversationKeyFieldOptions.hasUnsupportedCurrentTemplate) {
    return input.values.conversationKeyTemplate;
  }

  if (
    input.values.conversationKeyTemplate.trim().length === 0 ||
    !conversationKeyFieldOptions.supportedOptions.some(
      (option) => option.template === input.values.conversationKeyTemplate,
    )
  ) {
    return conversationKeyFieldOptions.supportedOptions[0]?.template ?? "";
  }

  return input.values.conversationKeyTemplate;
}

export function useWebhookAutomationEditorState(input: UseWebhookAutomationEditorStateInput): {
  connectionOptions: readonly {
    value: string;
    label: string;
    description?: string;
  }[];
  sandboxProfileOptions: readonly {
    value: string;
    label: string;
    description?: string;
  }[];
  webhookEventOptions: readonly WebhookAutomationEventOption[];
  values: WebhookAutomationFormValues;
  fieldErrors: Partial<Record<keyof WebhookAutomationFormValues, string>>;
  formError: string | null;
  pageError: string | null;
  deleteError: string | null;
  isDeleteDialogOpen: boolean;
  isDeleting: boolean;
  isLoadingInitialData: boolean;
  isSaving: boolean;
  onDeleteDialogOpenChange: (isOpen: boolean) => void;
  onRequestDelete: (() => void) | null;
  onConfirmDelete: () => void;
  onSubmit: () => void;
  onValueChange: (
    key: keyof WebhookAutomationFormValues,
    value: string | boolean | string[] | WebhookAutomationFormValues["triggerParameterValues"],
  ) => void;
} {
  const queryClient = useQueryClient();
  const automationQuery = useQuery({
    queryKey:
      input.automationId === undefined
        ? newWebhookAutomationDetailQueryKey()
        : webhookAutomationDetailQueryKey(input.automationId),
    queryFn: async ({ signal }) => {
      if (input.automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return getWebhookAutomation({
        automationId: input.automationId,
        signal,
      });
    },
    enabled: input.mode === "edit" && input.automationId !== undefined,
    retry: false,
  });

  const prerequisites = useWebhookAutomationPrerequisites(
    automationQuery.data === undefined
      ? undefined
      : {
          preservedConnectionId: automationQuery.data.integrationConnectionId,
        },
  );
  const formValuesSourceKey =
    input.mode === "edit" ? `edit:${input.automationId ?? "missing"}` : "create";
  const [formValuesState, setFormValuesState] =
    useState<KeyedValue<WebhookAutomationFormValues> | null>(null);
  const [fieldErrorsState, setFieldErrorsState] = useState<
    KeyedValue<Partial<Record<keyof WebhookAutomationFormValues, string>>>
  >({
    sourceKey: formValuesSourceKey,
    value: {},
  });
  const [formErrorState, setFormErrorState] = useState<KeyedValue<string | null>>({
    sourceKey: formValuesSourceKey,
    value: null,
  });
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const webhookEventOptions = useMemo(
    () =>
      prerequisites.integrationDirectoryQuery.data === undefined
        ? []
        : buildWebhookAutomationEventOptions({
            connections: prerequisites.integrationDirectoryQuery.data.connections,
            targets: prerequisites.integrationDirectoryQuery.data.targets,
            ...(automationQuery.data?.integrationConnectionId === undefined
              ? {}
              : { preservedConnectionId: automationQuery.data.integrationConnectionId }),
            selectedTriggerIds: formValues.triggerIds,
          }),
    [
      automationQuery.data?.integrationConnectionId,
      (formValuesState?.sourceKey === formValuesSourceKey
        ? formValuesState.value
        : toWebhookAutomationFormValues(null)
      ).triggerIds,
      prerequisites.integrationDirectoryQuery.data,
    ],
  );
  const hydratedFormValues = useMemo(() => {
    if (input.mode === "create") {
      return toWebhookAutomationFormValues(null);
    }

    if (
      automationQuery.data === undefined ||
      prerequisites.integrationDirectoryQuery.data === undefined
    ) {
      return null;
    }

    const automationTriggerIds = (automationQuery.data.eventTypes ?? []).map((eventType) =>
      createWebhookAutomationTriggerId({
        connectionId: automationQuery.data.integrationConnectionId,
        eventType,
      }),
    );
    const hydrationEventOptions = buildWebhookAutomationEventOptions({
      connections: prerequisites.integrationDirectoryQuery.data.connections,
      targets: prerequisites.integrationDirectoryQuery.data.targets,
      preservedConnectionId: automationQuery.data.integrationConnectionId,
      selectedTriggerIds: automationTriggerIds,
    });

    return toWebhookAutomationFormValues(automationQuery.data, hydrationEventOptions);
  }, [automationQuery.data, input.mode, prerequisites.integrationDirectoryQuery.data]);
  const formValues =
    formValuesState?.sourceKey === formValuesSourceKey
      ? formValuesState.value
      : (hydratedFormValues ?? toWebhookAutomationFormValues(null));
  const fieldErrors =
    fieldErrorsState.sourceKey === formValuesSourceKey ? fieldErrorsState.value : {};
  const formError = formErrorState.sourceKey === formValuesSourceKey ? formErrorState.value : null;

  const createMutation = useMutation({
    mutationFn: async (values: WebhookAutomationFormValues) =>
      createWebhookAutomation({
        payload: toCreateWebhookAutomationPayload(values, webhookEventOptions),
      }),
    onSuccess: async (automation) => {
      setFormErrorState({
        sourceKey: formValuesSourceKey,
        value: null,
      });
      await queryClient.invalidateQueries({
        queryKey: AUTOMATIONS_QUERY_KEY_PREFIX,
      });
      await input.navigate(`/automations/${automation.id}`);
    },
    onError: (error: unknown) => {
      setFormErrorState({
        sourceKey: formValuesSourceKey,
        value: resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not create automation.",
        }),
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (values: WebhookAutomationFormValues) => {
      if (input.automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return updateWebhookAutomation({
        payload: {
          automationId: input.automationId,
          payload: toUpdateWebhookAutomationPayload(values, webhookEventOptions),
        },
      });
    },
    onSuccess: async (automation) => {
      setFormErrorState({
        sourceKey: formValuesSourceKey,
        value: null,
      });
      setFormValuesState({
        sourceKey: formValuesSourceKey,
        value: toWebhookAutomationFormValues(automation, webhookEventOptions),
      });
      await queryClient.invalidateQueries({
        queryKey: AUTOMATIONS_QUERY_KEY_PREFIX,
      });
    },
    onError: (error: unknown) => {
      setFormErrorState({
        sourceKey: formValuesSourceKey,
        value: resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not update automation.",
        }),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (input.automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return deleteWebhookAutomation({
        automationId: input.automationId,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: AUTOMATIONS_QUERY_KEY_PREFIX,
      });
      await input.navigate("/automations");
    },
    onError: (error: unknown) => {
      setDeleteError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not delete automation.",
        }),
      );
    },
  });

  function onValueChange(
    key: keyof WebhookAutomationFormValues,
    value: string | boolean | string[] | WebhookAutomationFormValues["triggerParameterValues"],
  ): void {
    const nextValues: WebhookAutomationFormValues = {
      ...formValues,
      [key]: value,
    };

    if (key === "triggerIds") {
      nextValues.conversationKeyTemplate = resolveNormalizedConversationKeyTemplate({
        values: nextValues,
        eventOptions: webhookEventOptions,
      });
    }

    setFormValuesState({
      sourceKey: formValuesSourceKey,
      value: nextValues,
    });
    setFieldErrorsState({
      sourceKey: formValuesSourceKey,
      value: {
        ...fieldErrors,
        [key]: undefined,
      },
    });
    setFormErrorState({
      sourceKey: formValuesSourceKey,
      value: null,
    });
  }

  function submitForm(): void {
    const nextFieldErrors = validateWebhookAutomationFormValues(formValues, webhookEventOptions);
    setFieldErrorsState({
      sourceKey: formValuesSourceKey,
      value: nextFieldErrors,
    });
    setFormErrorState({
      sourceKey: formValuesSourceKey,
      value: null,
    });

    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }

    if (input.mode === "create") {
      createMutation.mutate(formValues);
      return;
    }

    updateMutation.mutate(formValues);
  }

  function requestDelete(): void {
    setDeleteError(null);
    setIsDeleteDialogOpen(true);
  }

  function confirmDelete(): void {
    deleteMutation.mutate();
  }

  const isLoadingInitialData =
    prerequisites.isPending || (input.mode === "edit" && automationQuery.isPending);

  const pageError =
    prerequisites.errorMessage !== null || automationQuery.isError
      ? resolveApiErrorMessage({
          error: automationQuery.error,
          fallbackMessage:
            prerequisites.errorMessage ??
            (input.mode === "edit"
              ? "Could not load automation."
              : "Could not load automation form."),
        })
      : null;

  return {
    connectionOptions: prerequisites.connectionOptions,
    sandboxProfileOptions: prerequisites.sandboxProfileOptions,
    webhookEventOptions,
    values: formValues,
    fieldErrors,
    formError,
    pageError,
    deleteError,
    isDeleteDialogOpen,
    isDeleting: deleteMutation.isPending,
    isLoadingInitialData,
    isSaving: createMutation.isPending || updateMutation.isPending,
    onDeleteDialogOpenChange: setIsDeleteDialogOpen,
    onRequestDelete: input.mode === "edit" ? requestDelete : null,
    onConfirmDelete: confirmDelete,
    onSubmit: submitForm,
    onValueChange,
  };
}
