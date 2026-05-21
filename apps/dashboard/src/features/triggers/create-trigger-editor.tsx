import { InlineCode } from "@mistle/ui";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { sandboxProfileVersionTriggerConfigQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfileVersionTriggerConfig } from "../sandbox-profiles/sandbox-profiles-service.js";
import {
  toCreateScheduledTriggerPayload,
  toScheduledTriggerFormValues,
  validateScheduledTriggerFormValues,
} from "./scheduled-trigger-form-helpers.js";
import { resolveScheduledTriggerFormPresentation } from "./scheduled-trigger-form-state.js";
import {
  type ScheduledTriggerFormValueKey,
  type ScheduledTriggerFormValues,
} from "./scheduled-trigger-form-types.js";
import { ScheduledTriggerTypeSpecificSection } from "./scheduled-trigger-form.js";
import { createScheduledTrigger } from "./scheduled-triggers-service.js";
import type { TriggerCreateSuccessPath } from "./trigger-editor-navigation.js";
import { TriggerFormShell } from "./trigger-form-shell.js";
import {
  getTriggerTemplateById,
  resolveTriggerTemplateEventOptionIds,
  type TriggerTemplate,
} from "./trigger-templates.js";
import { TriggerTypeSelectField, type TriggerTypeValue } from "./trigger-type-field.js";
import { TRIGGERS_QUERY_KEY_PREFIX } from "./triggers-query-keys.js";
import { useSelectedSandboxProfileVersion } from "./use-selected-sandbox-profile-version.js";
import { useTriggerSandboxProfileOptions } from "./use-trigger-sandbox-profile-options.js";
import {
  resolveNoActiveProfileVersionMessage,
  resolveSelectedProfileTriggerState,
} from "./use-webhook-trigger-editor-state.js";
import { useWebhookTriggerEventPrerequisites } from "./use-webhook-trigger-prerequisites.js";
import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterRulesByEventType,
} from "./webhook-trigger-event-types.js";
import {
  toCreateWebhookTriggerPayload,
  toWebhookTriggerFormValues,
  validateWebhookTriggerFormValues,
} from "./webhook-trigger-form-helpers.js";
import { resolveWebhookTriggerFormState } from "./webhook-trigger-form-state.js";
import {
  type WebhookTriggerFormValueKey,
  type WebhookTriggerFormValues,
} from "./webhook-trigger-form-types.js";
import {
  WebhookTriggerInstructionsSection,
  WebhookTriggerTypeSpecificSection,
} from "./webhook-trigger-form.js";
import { DefaultWebhookTriggerMessageTemplate } from "./webhook-trigger-input-template.js";
import {
  buildWebhookTriggerEventOptions,
  buildWebhookTriggerPrimaryRepositoryOptions,
  WebhookTriggerWorkspaceRootRepositoryOptionValue,
  withSelectedSandboxProfileOptionVersion,
} from "./webhook-trigger-option-builders.js";
import { createWebhookTrigger } from "./webhook-triggers-service.js";

type NavigateFunction = (to: string) => void | Promise<void>;

type CreateTriggerEditorProps = {
  navigate: NavigateFunction;
  initialSandboxProfileId?: string | undefined;
  initialTemplateId?: string | undefined;
  createSuccessPath?: TriggerCreateSuccessPath;
};

type CommonCreateTriggerFormValues = Pick<
  WebhookTriggerFormValues,
  "enabled" | "inputTemplate" | "name" | "primaryRepositoryId" | "sandboxProfileId"
>;

type CreateTriggerFormValues = CommonCreateTriggerFormValues &
  Pick<
    WebhookTriggerFormValues,
    "conversationKeyTemplate" | "instructions" | "eventIds" | "eventParameterRules"
  > &
  Pick<ScheduledTriggerFormValues, "conversationMode" | "cronExpression" | "timezone">;

type CreateTriggerFormValueKey =
  | keyof CommonCreateTriggerFormValues
  | "triggerType"
  | Exclude<WebhookTriggerFormValueKey, keyof CommonCreateTriggerFormValues>
  | Exclude<ScheduledTriggerFormValueKey, keyof CommonCreateTriggerFormValues>;

const RequiredFieldSummaryMessage = "Please address the fields highlighted in red.";
const RequiredTriggerTypeSelectionMessage = "Select a trigger source.";
const RequiredTriggerSelectionMessage = "Please add an event";
const MissingProfileVersionQueryId = 0;

function createInitialCreateTriggerFormValues(
  initialSandboxProfileId: string | undefined,
  initialTemplate: TriggerTemplate | null,
): CreateTriggerFormValues {
  const webhookValues = toWebhookTriggerFormValues(null);
  const scheduledValues = toScheduledTriggerFormValues(null);

  const initialValues: CreateTriggerFormValues = {
    name: "",
    sandboxProfileId: initialSandboxProfileId ?? "",
    primaryRepositoryId: "",
    enabled: true,
    inputTemplate: webhookValues.inputTemplate,
    instructions: webhookValues.instructions,
    conversationKeyTemplate: webhookValues.conversationKeyTemplate,
    eventIds: webhookValues.eventIds,
    eventParameterRules: webhookValues.eventParameterRules,
    cronExpression: scheduledValues.cronExpression,
    timezone: scheduledValues.timezone,
    conversationMode: scheduledValues.conversationMode,
  };

  if (initialTemplate === null) {
    return initialValues;
  }

  if (initialTemplate.kind === "scheduled") {
    return {
      ...initialValues,
      name: initialTemplate.name,
      inputTemplate: initialTemplate.inputTemplate,
      cronExpression: initialTemplate.cronExpression,
      conversationMode: initialTemplate.conversationMode,
    };
  }

  return {
    ...initialValues,
    name: initialTemplate.name,
    inputTemplate: initialTemplate.inputTemplate,
    instructions: initialTemplate.instructions,
    conversationKeyTemplate: initialTemplate.conversationKeyTemplate,
  };
}

function toWebhookValues(values: CreateTriggerFormValues): WebhookTriggerFormValues {
  return {
    name: values.name,
    sandboxProfileId: values.sandboxProfileId,
    primaryRepositoryId: values.primaryRepositoryId,
    enabled: values.enabled,
    inputTemplate: values.inputTemplate,
    instructions: values.instructions,
    conversationKeyTemplate: values.conversationKeyTemplate,
    eventIds: values.eventIds,
    eventParameterRules: values.eventParameterRules,
  };
}

function toScheduledValues(values: CreateTriggerFormValues): ScheduledTriggerFormValues {
  return {
    name: values.name,
    sandboxProfileId: values.sandboxProfileId,
    primaryRepositoryId: values.primaryRepositoryId,
    enabled: values.enabled,
    cronExpression: values.cronExpression,
    timezone: values.timezone,
    conversationMode: values.conversationMode,
    inputTemplate: values.inputTemplate,
  };
}

function hasRequiredFieldErrors(
  kind: TriggerTypeValue | null,
  fieldErrors: Partial<Record<CreateTriggerFormValueKey, string>>,
): boolean {
  if (
    fieldErrors.triggerType !== undefined ||
    fieldErrors.name !== undefined ||
    fieldErrors.sandboxProfileId !== undefined ||
    fieldErrors.inputTemplate !== undefined
  ) {
    return true;
  }

  if (kind === null) {
    return false;
  }

  if (kind === "scheduled") {
    return fieldErrors.cronExpression !== undefined || fieldErrors.timezone !== undefined;
  }

  return fieldErrors.eventIds === RequiredTriggerSelectionMessage;
}

function resolvePrimaryRepositorySelectionNormalization(input: {
  currentValues: CreateTriggerFormValues;
  selectedProfileId: string;
  hasLoadedTriggerConfig: boolean;
  primaryRepositoryOptions: readonly { value: string }[];
}): string | null {
  if (!input.hasLoadedTriggerConfig) {
    return null;
  }

  if (input.currentValues.sandboxProfileId.trim() !== input.selectedProfileId) {
    return null;
  }

  if (input.primaryRepositoryOptions.length === 0) {
    return input.currentValues.primaryRepositoryId.trim().length === 0 ? null : "";
  }

  return input.primaryRepositoryOptions.some(
    (option) => option.value === input.currentValues.primaryRepositoryId,
  )
    ? null
    : WebhookTriggerWorkspaceRootRepositoryOptionValue;
}

function resolveNormalizedConversationKeyTemplate(input: {
  values: CreateTriggerFormValues;
  eventOptions: readonly WebhookTriggerEventOption[];
}): string {
  const formState = resolveWebhookTriggerFormState({
    webhookEventOptions: input.eventOptions,
    selectedEventIds: input.values.eventIds,
    conversationKeyTemplate: input.values.conversationKeyTemplate,
    eventParameterRules: input.values.eventParameterRules,
    eventIdsError: undefined,
  });
  const conversationKeyFieldOptions = formState.conversationKeySelectionState;

  if (conversationKeyFieldOptions.options.length === 0) {
    return input.values.conversationKeyTemplate;
  }

  if (conversationKeyFieldOptions.hasUnsupportedCurrentTemplate) {
    return "";
  }

  if (
    input.values.conversationKeyTemplate.trim().length === 0 ||
    conversationKeyFieldOptions.selectedTemplate.length === 0
  ) {
    return conversationKeyFieldOptions.options[0]?.template ?? "";
  }

  return input.values.conversationKeyTemplate;
}

function applyEventIdsChange(input: {
  values: CreateTriggerFormValues;
  eventIds: string[];
  eventOptions: readonly WebhookTriggerEventOption[];
  eventParameterRulesByEventType?: WebhookTriggerEventParameterRulesByEventType;
}): CreateTriggerFormValues {
  const nextValues: CreateTriggerFormValues = {
    ...input.values,
    eventIds: input.eventIds,
    eventParameterRules: Object.fromEntries(
      input.eventIds.map((triggerId) => {
        const eventOption = input.eventOptions.find((option) => option.id === triggerId);
        const templateParameterRules =
          eventOption === undefined
            ? undefined
            : input.eventParameterRulesByEventType?.[eventOption.eventType];

        return [
          triggerId,
          templateParameterRules ?? input.values.eventParameterRules[triggerId] ?? {},
        ];
      }),
    ),
  };

  return {
    ...nextValues,
    conversationKeyTemplate: resolveNormalizedConversationKeyTemplate({
      values: nextValues,
      eventOptions: input.eventOptions,
    }),
  };
}

function resolveDefaultInputTemplate(kind: TriggerTypeValue): string {
  return kind === "scheduled"
    ? toScheduledTriggerFormValues(null).inputTemplate
    : toWebhookTriggerFormValues(null).inputTemplate;
}

function resolveCreateTriggerMutationErrorMessage(input: {
  error: unknown;
  fallbackMessage: string;
}): string {
  return resolveApiErrorMessage({
    error: input.error,
    fallbackMessage: input.fallbackMessage,
  });
}

async function invalidateTriggersQuery(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: TRIGGERS_QUERY_KEY_PREFIX,
  });
}

function useCreateTriggerEditorState(input: CreateTriggerEditorProps) {
  const queryClient = useQueryClient();
  const initialTemplate =
    input.initialTemplateId === undefined ? null : getTriggerTemplateById(input.initialTemplateId);
  const [kind, setKind] = useState<TriggerTypeValue | null>(initialTemplate?.kind ?? null);
  const [formValues, setFormValues] = useState<CreateTriggerFormValues>(() =>
    createInitialCreateTriggerFormValues(input.initialSandboxProfileId, initialTemplate),
  );
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(
    initialTemplate?.kind === "scheduled" ? (input.initialTemplateId ?? null) : null,
  );
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<CreateTriggerFormValueKey, string>>
  >({});
  const [validationSummaryError, setValidationSummaryError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const sandboxProfilePrerequisites = useTriggerSandboxProfileOptions();
  const eventPrerequisites = useWebhookTriggerEventPrerequisites({
    enabled: kind === "trigger",
  });
  const selectedProfileId = formValues.sandboxProfileId.trim();
  const {
    effectiveSelectedProfileVersion,
    hasActiveProfileVersion,
    isUsingPinnedSelectedProfileVersion,
    selectedProfileVersionsQuery,
    setSelectedSandboxProfileVersion,
  } = useSelectedSandboxProfileVersion({
    selectedProfileId,
  });
  const selectedProfileTriggerConfigQuery = useQuery({
    queryKey: sandboxProfileVersionTriggerConfigQueryKey({
      profileId: selectedProfileId,
      version: effectiveSelectedProfileVersion ?? MissingProfileVersionQueryId,
    }),
    queryFn: async ({ signal }) => {
      if (effectiveSelectedProfileVersion === null) {
        throw new Error("No sandbox profile version is available for this profile.");
      }

      return getSandboxProfileVersionTriggerConfig({
        profileId: selectedProfileId,
        version: effectiveSelectedProfileVersion,
        signal,
      });
    },
    enabled: selectedProfileId.length > 0 && effectiveSelectedProfileVersion !== null,
    retry: false,
  });
  const selectedProfileTriggerConfig = selectedProfileTriggerConfigQuery.data;
  const hasLoadedSelectedProfileTriggerConfig = selectedProfileTriggerConfig !== undefined;
  const selectedProfileRepositoryOptions = selectedProfileTriggerConfig?.repositoryOptions ?? [];
  const primaryRepositoryOptions = useMemo(
    () =>
      buildWebhookTriggerPrimaryRepositoryOptions({
        repositoryOptions: selectedProfileRepositoryOptions,
      }),
    [selectedProfileRepositoryOptions],
  );
  const sandboxProfileOptions = useMemo(
    () =>
      withSelectedSandboxProfileOptionVersion({
        options: sandboxProfilePrerequisites.sandboxProfileOptions,
        selectedProfileId,
        selectedVersion: effectiveSelectedProfileVersion,
      }),
    [
      effectiveSelectedProfileVersion,
      sandboxProfilePrerequisites.sandboxProfileOptions,
      selectedProfileId,
    ],
  );
  const selectedProfileBindingsError = isUsingPinnedSelectedProfileVersion
    ? selectedProfileTriggerConfigQuery.error
    : (selectedProfileVersionsQuery.error ?? selectedProfileTriggerConfigQuery.error);
  const selectedProfileBindingsErrorMessage =
    selectedProfileBindingsError === null
      ? null
      : resolveApiErrorMessage({
          error: selectedProfileBindingsError,
          fallbackMessage: "Could not load profile bindings.",
        });
  const selectedProfileName = sandboxProfileOptions.find(
    (option) => option.value === selectedProfileId,
  )?.label;
  const selectedProfileTriggerState = useMemo(
    () =>
      resolveSelectedProfileTriggerState({
        selectedProfileId,
        selectedProfileName,
        hasActiveProfileVersion,
        hasBindingData: hasLoadedSelectedProfileTriggerConfig,
        isBindingDataPending:
          selectedProfileId.length > 0 &&
          ((isUsingPinnedSelectedProfileVersion ? false : selectedProfileVersionsQuery.isPending) ||
            (effectiveSelectedProfileVersion !== null &&
              selectedProfileTriggerConfigQuery.isPending)),
        bindingErrorMessage: selectedProfileBindingsErrorMessage,
        bindings: selectedProfileTriggerConfig?.bindings ?? [],
        directoryData: eventPrerequisites.directoryData ?? {
          connections: [],
          targets: [],
          webhookSources: [],
        },
      }),
    [
      effectiveSelectedProfileVersion,
      hasActiveProfileVersion,
      hasLoadedSelectedProfileTriggerConfig,
      isUsingPinnedSelectedProfileVersion,
      eventPrerequisites.directoryData,
      selectedProfileTriggerConfig,
      selectedProfileTriggerConfigQuery.isPending,
      selectedProfileBindingsErrorMessage,
      selectedProfileId,
      selectedProfileName,
      selectedProfileVersionsQuery.isPending,
    ],
  );
  const sandboxProfileStatusMessage =
    hasActiveProfileVersion === false
      ? {
          message: resolveNoActiveProfileVersionMessage({
            selectedProfileId,
            selectedProfileName,
          }),
          variant: "alert" as const,
        }
      : undefined;
  const webhookEventOptions = useMemo(
    () =>
      eventPrerequisites.directoryData === undefined
        ? []
        : buildWebhookTriggerEventOptions({
            connections: eventPrerequisites.directoryData.connections,
            targets: eventPrerequisites.directoryData.targets,
            webhookSources: eventPrerequisites.directoryData.webhookSources,
            selectableConnectionIds: selectedProfileTriggerState.selectableConnectionIds,
            selectedEventIds: formValues.eventIds,
          }),
    [
      formValues.eventIds,
      eventPrerequisites.directoryData,
      selectedProfileTriggerState.selectableConnectionIds,
    ],
  );

  useEffect(() => {
    if (
      initialTemplate === null ||
      initialTemplate.kind !== "trigger" ||
      input.initialTemplateId === undefined ||
      appliedTemplateId === input.initialTemplateId ||
      eventPrerequisites.isPending ||
      eventPrerequisites.directoryData === undefined ||
      !hasLoadedSelectedProfileTriggerConfig
    ) {
      return;
    }

    const templateEventIds = resolveTriggerTemplateEventOptionIds({
      template: initialTemplate,
      eventOptions: webhookEventOptions,
    });
    if (templateEventIds === null) {
      setAppliedTemplateId(input.initialTemplateId);
      return;
    }

    setFormValues((currentValues) =>
      applyEventIdsChange({
        values: currentValues,
        eventIds: templateEventIds,
        eventOptions: webhookEventOptions,
        ...(initialTemplate.eventParameterRulesByEventType === undefined
          ? {}
          : {
              eventParameterRulesByEventType: initialTemplate.eventParameterRulesByEventType,
            }),
      }),
    );
    setAppliedTemplateId(input.initialTemplateId);
  }, [
    appliedTemplateId,
    eventPrerequisites.directoryData,
    eventPrerequisites.isPending,
    hasLoadedSelectedProfileTriggerConfig,
    initialTemplate,
    input.initialTemplateId,
    webhookEventOptions,
  ]);

  useEffect(() => {
    setFormValues((currentValues) => {
      const normalizedPrimaryRepositoryId = resolvePrimaryRepositorySelectionNormalization({
        currentValues,
        selectedProfileId,
        hasLoadedTriggerConfig: hasLoadedSelectedProfileTriggerConfig,
        primaryRepositoryOptions,
      });
      if (normalizedPrimaryRepositoryId === null) {
        return currentValues;
      }

      return {
        ...currentValues,
        primaryRepositoryId: normalizedPrimaryRepositoryId,
      };
    });
  }, [
    primaryRepositoryOptions,
    hasLoadedSelectedProfileTriggerConfig,
    selectedProfileTriggerConfig,
    selectedProfileId,
  ]);

  const createWebhookMutation = useMutation({
    mutationFn: async (values: WebhookTriggerFormValues) =>
      createWebhookTrigger({
        payload: toCreateWebhookTriggerPayload(values, webhookEventOptions),
      }),
    onSuccess: async (trigger) => {
      setSelectedSandboxProfileVersion({
        profileId: trigger.target.sandboxProfileId,
        version: trigger.target.sandboxProfileVersion,
      });
      setValidationSummaryError(null);
      setFormError(null);
      await invalidateTriggersQuery(queryClient);
      await input.navigate(
        input.createSuccessPath === undefined
          ? `/triggers/${trigger.id}`
          : input.createSuccessPath(trigger),
      );
    },
    onError: (error: unknown) => {
      setFormError(
        resolveCreateTriggerMutationErrorMessage({
          error,
          fallbackMessage: "Could not create trigger.",
        }),
      );
    },
  });
  const createScheduledMutation = useMutation({
    mutationFn: async (values: ScheduledTriggerFormValues) =>
      createScheduledTrigger({
        payload: toCreateScheduledTriggerPayload(values),
      }),
    onSuccess: async (trigger) => {
      setSelectedSandboxProfileVersion({
        profileId: trigger.target.sandboxProfileId,
        version: trigger.target.sandboxProfileVersion,
      });
      setValidationSummaryError(null);
      setFormError(null);
      await invalidateTriggersQuery(queryClient);
      await input.navigate(
        input.createSuccessPath === undefined
          ? `/triggers/${trigger.id}`
          : input.createSuccessPath(trigger),
      );
    },
    onError: (error: unknown) => {
      setFormError(
        resolveCreateTriggerMutationErrorMessage({
          error,
          fallbackMessage: "Could not create trigger.",
        }),
      );
    },
  });

  function onKindChange(nextKind: TriggerTypeValue): void {
    setFormValues((currentValues) => {
      const currentDefaultInputTemplate =
        kind === null ? resolveDefaultInputTemplate("trigger") : resolveDefaultInputTemplate(kind);
      if (currentValues.inputTemplate !== currentDefaultInputTemplate) {
        return currentValues;
      }

      return {
        ...currentValues,
        inputTemplate: resolveDefaultInputTemplate(nextKind),
      };
    });
    setKind(nextKind);
    setFieldErrors((currentErrors) => {
      const { triggerType: _triggerType, ...remainingErrors } = currentErrors;

      void _triggerType;

      return remainingErrors;
    });
    setValidationSummaryError(null);
    setFormError(null);
  }

  function onCommonValueChange(key: keyof CommonCreateTriggerFormValues, value: string | boolean) {
    setFormValues((currentValues) => {
      if (key === "sandboxProfileId") {
        return {
          ...currentValues,
          sandboxProfileId: typeof value === "string" ? value : currentValues.sandboxProfileId,
          primaryRepositoryId: "",
        };
      }

      return {
        ...currentValues,
        [key]: value,
      };
    });

    if (key === "sandboxProfileId") {
      setSelectedSandboxProfileVersion(null);
    }

    setFieldErrors((currentErrors) => {
      if (key === "sandboxProfileId") {
        const {
          sandboxProfileId: _sandboxProfileId,
          primaryRepositoryId: _primaryRepositoryId,
          eventIds: _eventIds,
          conversationKeyTemplate: _conversationKeyTemplate,
          ...remainingErrors
        } = currentErrors;

        void _sandboxProfileId;
        void _primaryRepositoryId;
        void _eventIds;
        void _conversationKeyTemplate;

        return remainingErrors;
      }

      if (key === "enabled") {
        const { enabled: _enabled, ...remainingErrors } = currentErrors;

        void _enabled;

        return remainingErrors;
      }

      if (key === "inputTemplate") {
        const { inputTemplate: _inputTemplate, ...remainingErrors } = currentErrors;

        void _inputTemplate;

        return remainingErrors;
      }

      if (key === "name") {
        const { name: _name, ...remainingErrors } = currentErrors;

        void _name;

        return remainingErrors;
      }

      const { primaryRepositoryId: _primaryRepositoryId, ...remainingErrors } = currentErrors;

      void _primaryRepositoryId;

      return remainingErrors;
    });
    setValidationSummaryError(null);
    setFormError(null);
  }

  function onWebhookValueChange(
    key: "conversationKeyTemplate" | "eventIds" | "eventParameterRules",
    value: string | string[] | WebhookTriggerFormValues["eventParameterRules"],
  ) {
    setFormValues((currentValues) => {
      if (key === "eventIds") {
        return applyEventIdsChange({
          values: currentValues,
          eventIds: Array.isArray(value) ? value : currentValues.eventIds,
          eventOptions: webhookEventOptions,
        });
      }

      const nextValues = {
        ...currentValues,
        [key]: value,
      };

      if (key === "eventParameterRules") {
        return {
          ...nextValues,
          conversationKeyTemplate: resolveNormalizedConversationKeyTemplate({
            values: nextValues,
            eventOptions: webhookEventOptions,
          }),
        };
      }

      return nextValues;
    });
    setFieldErrors((currentErrors) => {
      if (key === "eventIds") {
        const {
          eventIds: _eventIds,
          conversationKeyTemplate: _conversationKeyTemplate,
          ...remainingErrors
        } = currentErrors;

        void _eventIds;
        void _conversationKeyTemplate;

        return remainingErrors;
      }

      if (key === "conversationKeyTemplate") {
        const { conversationKeyTemplate: _conversationKeyTemplate, ...remainingErrors } =
          currentErrors;

        void _conversationKeyTemplate;

        return remainingErrors;
      }

      const { eventParameterRules: _eventParameterRules, ...remainingErrors } = currentErrors;

      void _eventParameterRules;

      return remainingErrors;
    });
    setValidationSummaryError(null);
    setFormError(null);
  }

  function onWebhookInstructionsChange(value: string): void {
    setFormValues((currentValues) => ({
      ...currentValues,
      instructions: value,
    }));
    setFieldErrors((currentErrors) => {
      const { instructions: _instructions, ...remainingErrors } = currentErrors;

      void _instructions;

      return remainingErrors;
    });
    setValidationSummaryError(null);
    setFormError(null);
  }

  function onScheduledValueChange(
    key: "conversationMode" | "cronExpression" | "timezone",
    value: string,
  ) {
    setFormValues((currentValues) => ({
      ...currentValues,
      [key]: value,
    }));
    setFieldErrors((currentErrors) => {
      if (key === "conversationMode") {
        const { conversationMode: _conversationMode, ...remainingErrors } = currentErrors;

        void _conversationMode;

        return remainingErrors;
      }

      if (key === "cronExpression") {
        const { cronExpression: _cronExpression, ...remainingErrors } = currentErrors;

        void _cronExpression;

        return remainingErrors;
      }

      const { timezone: _timezone, ...remainingErrors } = currentErrors;

      void _timezone;

      return remainingErrors;
    });
    setValidationSummaryError(null);
    setFormError(null);
  }

  function onSubmit() {
    const nextFieldErrors: Partial<Record<CreateTriggerFormValueKey, string>> =
      kind === null
        ? { triggerType: RequiredTriggerTypeSelectionMessage }
        : kind === "scheduled"
          ? validateScheduledTriggerFormValues(toScheduledValues(formValues))
          : validateWebhookTriggerFormValues(toWebhookValues(formValues), webhookEventOptions);
    if (hasActiveProfileVersion === false) {
      nextFieldErrors.sandboxProfileId = resolveNoActiveProfileVersionMessage({
        selectedProfileId,
        selectedProfileName,
      });
    }
    setFieldErrors(nextFieldErrors);
    setValidationSummaryError(
      hasRequiredFieldErrors(kind, nextFieldErrors) ? RequiredFieldSummaryMessage : null,
    );
    setFormError(null);

    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }

    if (kind === "scheduled") {
      createScheduledMutation.mutate(toScheduledValues(formValues));
      return;
    }

    createWebhookMutation.mutate(toWebhookValues(formValues));
  }

  return {
    kind,
    formValues,
    fieldErrors,
    validationSummaryError,
    formError:
      formError ??
      sandboxProfilePrerequisites.errorMessage ??
      (kind === "trigger" ? eventPrerequisites.errorMessage : null),
    isPending:
      sandboxProfilePrerequisites.errorMessage === null &&
      (kind === null || kind === "scheduled"
        ? sandboxProfilePrerequisites.isPending
        : eventPrerequisites.errorMessage === null &&
          (eventPrerequisites.isPending || eventPrerequisites.directoryData === undefined)),
    isSaving: createWebhookMutation.isPending || createScheduledMutation.isPending,
    sandboxProfileOptions,
    primaryRepositoryOptions,
    sandboxProfileStatusMessage,
    connectionOptions: eventPrerequisites.connectionOptions,
    webhookEventOptions,
    triggerPickerDisabledState: selectedProfileTriggerState.disabledState,
    onKindChange,
    onCommonValueChange,
    onWebhookValueChange,
    onWebhookInstructionsChange,
    onScheduledValueChange,
    onSubmit,
  };
}

function renderInputTemplateDescription(input: {
  kind: TriggerTypeValue;
  formState: ReturnType<typeof resolveWebhookTriggerFormState>;
}): ReactNode {
  if (input.kind === "scheduled") {
    return "Sent to the agent each time the trigger runs.";
  }

  if (input.formState.hasSelectedTrigger) {
    return (
      <>
        <span className="block">Sent to the agent each time the trigger runs.</span>
        <span className="block">
          Use <InlineCode variant="muted">{"{{ ... }}"}</InlineCode> to insert event fields.
        </span>
      </>
    );
  }

  return (
    <>
      <span className="block">Sent to the agent each time the trigger runs.</span>
      <span className="block">Select a trigger to insert event fields.</span>
    </>
  );
}

export function CreateTriggerEditor(input: CreateTriggerEditorProps): React.JSX.Element | null {
  const state = useCreateTriggerEditorState(input);
  const presentation = resolveScheduledTriggerFormPresentation({
    mode: "create",
    values: state.formValues,
    primaryRepositoryOptions: state.primaryRepositoryOptions,
  });
  const formState = resolveWebhookTriggerFormState({
    webhookEventOptions: state.webhookEventOptions,
    selectedEventIds: state.formValues.eventIds,
    conversationKeyTemplate: state.formValues.conversationKeyTemplate,
    eventParameterRules: state.formValues.eventParameterRules,
    eventIdsError: state.fieldErrors.eventIds,
  });

  if (state.isPending) {
    return null;
  }

  return (
    <TriggerFormShell
      triggerTypeField={
        <TriggerTypeSelectField
          error={state.fieldErrors.triggerType}
          onValueChange={state.onKindChange}
          value={state.kind}
        />
      }
      enabled={state.formValues.enabled}
      fieldErrors={state.fieldErrors}
      formError={state.formError}
      inputIdPrefix="trigger"
      inputTemplate={state.formValues.inputTemplate}
      inputTemplateDescription={
        state.kind === null
          ? ""
          : renderInputTemplateDescription({
              kind: state.kind,
              formState,
            })
      }
      inputTemplateLabelId="trigger-input-template-label"
      {...(state.kind === "trigger"
        ? { inputTemplatePlaceholderText: DefaultWebhookTriggerMessageTemplate }
        : {})}
      inputTemplateTokens={state.kind === "trigger" ? formState.agentInstructionTokens : []}
      isDeleting={false}
      isSaving={state.isSaving}
      mode="create"
      name={state.formValues.name}
      onDelete={null}
      onSubmit={state.onSubmit}
      onValueChange={(key, value) => {
        state.onCommonValueChange(key, value);
      }}
      primaryRepositoryId={state.formValues.primaryRepositoryId}
      primaryRepositoryOptions={state.primaryRepositoryOptions}
      sandboxProfileId={state.formValues.sandboxProfileId}
      sandboxProfileOptions={state.sandboxProfileOptions}
      sandboxProfileStatusMessage={state.sandboxProfileStatusMessage}
      selectedPrimaryRepositoryPath={presentation.selectedPrimaryRepositoryPath}
      selectedWorkspaceRoot={presentation.selectedWorkspaceRoot}
      shouldShowTriggerEnabledField={presentation.shouldShowTriggerEnabledField}
      shouldShowCreateNameField={presentation.shouldShowCreateNameField}
      shouldShowMessageSection={state.kind !== null}
      shouldShowPrimaryRepositoryField={presentation.shouldShowPrimaryRepositoryField}
      submitLabel={presentation.submitLabel}
      validationSummaryError={state.validationSummaryError}
      extraSectionsBeforeMessage={
        state.kind === "trigger" ? (
          <WebhookTriggerInstructionsSection
            disabled={state.isSaving}
            instructionsLabelId="trigger-instructions-label"
            onValueChange={state.onWebhookInstructionsChange}
            value={state.formValues.instructions}
          />
        ) : undefined
      }
      typeSpecificSection={
        state.kind === null ? null : state.kind === "scheduled" ? (
          <ScheduledTriggerTypeSpecificSection
            fieldErrors={state.fieldErrors}
            isDeleting={false}
            isSaving={state.isSaving}
            onValueChange={state.onScheduledValueChange}
            values={state.formValues}
          />
        ) : (
          <WebhookTriggerTypeSpecificSection
            connectionOptions={state.connectionOptions}
            fieldErrors={state.fieldErrors}
            formState={formState}
            onValueChange={state.onWebhookValueChange}
            triggerPickerDisabledState={state.triggerPickerDisabledState}
            values={state.formValues}
            webhookEventOptions={state.webhookEventOptions}
          />
        )
      }
    />
  );
}
