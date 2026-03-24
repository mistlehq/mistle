import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
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
import { extractWebhookAutomationTriggerParameterValues } from "./webhook-automation-trigger-parameters.js";
import { resolveSelectedWebhookAutomationEventOptions } from "./webhook-automation-trigger-picker.js";
import { AUTOMATIONS_QUERY_KEY_PREFIX } from "./webhook-automations-query-keys.js";
import {
  createWebhookAutomation,
  deleteWebhookAutomation,
  updateWebhookAutomation,
} from "./webhook-automations-service.js";
import type { WebhookAutomation } from "./webhook-automations-types.js";

type NavigateFunction = (to: string) => void | Promise<void>;

type DirectoryData = {
  connections: readonly IntegrationConnection[];
  targets: readonly IntegrationTarget[];
};

type WebhookAutomationOption = {
  value: string;
  label: string;
  description?: string;
};

type LoadedWebhookAutomationEditorStateInput = {
  mode: "create" | "edit";
  automationId: string | undefined;
  navigate: NavigateFunction;
  initialValues: WebhookAutomationFormValues;
  templateParseError: string | null;
  preservedInputTemplate: string | null;
  connectionOptions: readonly WebhookAutomationOption[];
  sandboxProfileOptions: readonly WebhookAutomationOption[];
  directoryData: DirectoryData;
  preservedConnectionId?: string;
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

export function resolveWebhookAutomationEditInitialValues(input: {
  automation: WebhookAutomation;
  directoryData: DirectoryData;
}): {
  initialValues: WebhookAutomationFormValues;
  templateParseError: string | null;
  preservedInputTemplate: string | null;
} {
  const automationTriggerIds = (input.automation.eventTypes ?? []).map((eventType) =>
    createWebhookAutomationTriggerId({
      connectionId: input.automation.integrationConnectionId,
      eventType,
    }),
  );
  const hydrationEventOptions = buildWebhookAutomationEventOptions({
    connections: input.directoryData.connections,
    targets: input.directoryData.targets,
    preservedConnectionId: input.automation.integrationConnectionId,
    selectedTriggerIds: automationTriggerIds,
  });
  const extractedTriggerParameterValues = extractWebhookAutomationTriggerParameterValues({
    eventOptions: hydrationEventOptions,
    selectedTriggerIds: automationTriggerIds,
    payloadFilter: input.automation.payloadFilter,
  });

  try {
    return {
      initialValues: toWebhookAutomationFormValues(input.automation, hydrationEventOptions),
      templateParseError: null,
      preservedInputTemplate: null,
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        initialValues: {
          name: input.automation.name,
          sandboxProfileId: input.automation.target.sandboxProfileId,
          enabled: input.automation.enabled,
          instructions: "",
          conversationKeyTemplate: input.automation.conversationKeyTemplate,
          triggerIds: automationTriggerIds,
          triggerParameterValues: extractedTriggerParameterValues.triggerParameterValues,
        },
        templateParseError: error.message,
        preservedInputTemplate: input.automation.inputTemplate,
      };
    }

    throw error;
  }
}

export function useLoadedWebhookAutomationEditorState(
  input: LoadedWebhookAutomationEditorStateInput,
): {
  connectionOptions: readonly WebhookAutomationOption[];
  sandboxProfileOptions: readonly WebhookAutomationOption[];
  webhookEventOptions: readonly WebhookAutomationEventOption[];
  values: WebhookAutomationFormValues;
  fieldErrors: Partial<Record<keyof WebhookAutomationFormValues, string>>;
  templateParseError: string | null;
  formError: string | null;
  deleteError: string | null;
  isDeleteDialogOpen: boolean;
  isDeleting: boolean;
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
  const [formValues, setFormValues] = useState(input.initialValues);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof WebhookAutomationFormValues, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [templateParseError] = useState<string | null>(input.templateParseError);
  const [preservedInputTemplate] = useState<string | null>(input.preservedInputTemplate);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const webhookEventOptions = useMemo(
    () =>
      buildWebhookAutomationEventOptions({
        connections: input.directoryData.connections,
        targets: input.directoryData.targets,
        ...(input.preservedConnectionId === undefined
          ? {}
          : { preservedConnectionId: input.preservedConnectionId }),
        selectedTriggerIds: formValues.triggerIds,
      }),
    [formValues.triggerIds, input.directoryData, input.preservedConnectionId],
  );

  const createMutation = useMutation({
    mutationFn: async (values: WebhookAutomationFormValues) =>
      createWebhookAutomation({
        payload: toCreateWebhookAutomationPayload(values, webhookEventOptions),
      }),
    onSuccess: async (automation) => {
      setFormError(null);
      await queryClient.invalidateQueries({
        queryKey: AUTOMATIONS_QUERY_KEY_PREFIX,
      });
      await input.navigate(`/automations/${automation.id}`);
    },
    onError: (error: unknown) => {
      setFormError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not create automation.",
        }),
      );
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
          payload: toUpdateWebhookAutomationPayload(values, webhookEventOptions, {
            ...(templateParseError === null
              ? {}
              : {
                  inputTemplateOverride:
                    preservedInputTemplate ??
                    (() => {
                      throw new Error("Expected original input template to be preserved.");
                    })(),
                }),
          }),
        },
      });
    },
    onSuccess: async (automation) => {
      if (templateParseError === null) {
        setFormValues(toWebhookAutomationFormValues(automation, webhookEventOptions));
      }
      setFieldErrors({});
      setFormError(null);
      await queryClient.invalidateQueries({
        queryKey: AUTOMATIONS_QUERY_KEY_PREFIX,
      });
    },
    onError: (error: unknown) => {
      setFormError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not update automation.",
        }),
      );
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

    if (key === "instructions" && templateParseError !== null) {
      return;
    }

    if (key === "triggerIds") {
      nextValues.conversationKeyTemplate = resolveNormalizedConversationKeyTemplate({
        values: nextValues,
        eventOptions: webhookEventOptions,
      });
    }

    setFormValues(nextValues);
    setFieldErrors((currentErrors) => ({
      ...currentErrors,
      [key]: undefined,
    }));
    setFormError(null);
  }

  function onSubmit(): void {
    const nextFieldErrors = validateWebhookAutomationFormValues(formValues, webhookEventOptions, {
      requireInstructions: templateParseError === null,
    });
    setFieldErrors(nextFieldErrors);
    setFormError(null);

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

  return {
    connectionOptions: input.connectionOptions,
    sandboxProfileOptions: input.sandboxProfileOptions,
    webhookEventOptions,
    values: formValues,
    fieldErrors,
    templateParseError,
    formError,
    deleteError,
    isDeleteDialogOpen,
    isDeleting: deleteMutation.isPending,
    isSaving: createMutation.isPending || updateMutation.isPending,
    onDeleteDialogOpenChange: setIsDeleteDialogOpen,
    onRequestDelete: input.mode === "edit" ? requestDelete : null,
    onConfirmDelete: confirmDelete,
    onSubmit,
    onValueChange,
  };
}
