import { InlineCode } from "@mistle/ui";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  sandboxProfileVersionAutomationConfigQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  getSandboxProfileVersionAutomationConfig,
  listSandboxProfileVersions,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { AutomationCreateSuccessPath } from "./automation-editor-navigation.js";
import { AutomationFormShell } from "./automation-form-shell.js";
import { AutomationTypeSelectField, type AutomationTypeValue } from "./automation-type-field.js";
import { AUTOMATIONS_QUERY_KEY_PREFIX } from "./automations-query-keys.js";
import {
  toCreateScheduledAutomationPayload,
  toScheduledAutomationFormValues,
  validateScheduledAutomationFormValues,
} from "./scheduled-automation-form-helpers.js";
import { resolveScheduledAutomationFormPresentation } from "./scheduled-automation-form-state.js";
import {
  type ScheduledAutomationFormValueKey,
  type ScheduledAutomationFormValues,
} from "./scheduled-automation-form-types.js";
import { ScheduledAutomationTypeSpecificSection } from "./scheduled-automation-form.js";
import { createScheduledAutomation } from "./scheduled-automations-service.js";
import {
  getTriggerTemplateById,
  resolveTriggerTemplateEventOptionIds,
  type TriggerTemplate,
} from "./trigger-templates.js";
import { useAutomationSandboxProfileOptions } from "./use-automation-sandbox-profile-options.js";
import {
  resolveNoActiveProfileVersionMessage,
  resolveSelectedProfileTriggerState,
} from "./use-webhook-automation-editor-state.js";
import { useWebhookAutomationEventPrerequisites } from "./use-webhook-automation-prerequisites.js";
import {
  toCreateWebhookAutomationPayload,
  toWebhookAutomationFormValues,
  validateWebhookAutomationFormValues,
} from "./webhook-automation-form-helpers.js";
import { resolveWebhookAutomationFormState } from "./webhook-automation-form-state.js";
import {
  type WebhookAutomationFormValueKey,
  type WebhookAutomationFormValues,
} from "./webhook-automation-form-types.js";
import {
  WebhookAutomationInstructionsSection,
  WebhookAutomationTypeSpecificSection,
} from "./webhook-automation-form.js";
import { DefaultWebhookAutomationMessageTemplate } from "./webhook-automation-input-template.js";
import {
  buildWebhookAutomationEventOptions,
  buildWebhookAutomationPrimaryRepositoryOptions,
  WebhookAutomationWorkspaceRootRepositoryOptionValue,
} from "./webhook-automation-option-builders.js";
import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";
import { createWebhookAutomation } from "./webhook-automations-service.js";

type NavigateFunction = (to: string) => void | Promise<void>;

type CreateAutomationEditorProps = {
  navigate: NavigateFunction;
  initialSandboxProfileId?: string | undefined;
  initialTemplateId?: string | undefined;
  createSuccessPath?: AutomationCreateSuccessPath;
};

type CommonCreateAutomationFormValues = Pick<
  WebhookAutomationFormValues,
  "enabled" | "inputTemplate" | "name" | "primaryRepositoryId" | "sandboxProfileId"
>;

type CreateAutomationFormValues = CommonCreateAutomationFormValues &
  Pick<
    WebhookAutomationFormValues,
    "conversationKeyTemplate" | "instructions" | "triggerIds" | "triggerParameterValues"
  > &
  Pick<ScheduledAutomationFormValues, "conversationMode" | "cronExpression" | "timezone">;

type CreateAutomationFormValueKey =
  | keyof CommonCreateAutomationFormValues
  | "automationType"
  | Exclude<WebhookAutomationFormValueKey, keyof CommonCreateAutomationFormValues>
  | Exclude<ScheduledAutomationFormValueKey, keyof CommonCreateAutomationFormValues>;

type SelectedSandboxProfileVersion = {
  profileId: string;
  version: number;
};

const RequiredFieldSummaryMessage = "Please address the fields highlighted in red.";
const RequiredAutomationTypeSelectionMessage = "Select a trigger source.";
const RequiredTriggerSelectionMessage = "Please add an event";
const MissingProfileVersionQueryId = 0;

function resolveActiveVersion(versions: readonly SandboxProfileVersion[]): number | null {
  const activeVersion = versions.find((version) => version.isActive);
  return activeVersion?.version ?? null;
}

function createInitialCreateAutomationFormValues(
  initialSandboxProfileId: string | undefined,
  initialTemplate: TriggerTemplate | null,
): CreateAutomationFormValues {
  const webhookValues = toWebhookAutomationFormValues(null);
  const scheduledValues = toScheduledAutomationFormValues(null);

  const initialValues: CreateAutomationFormValues = {
    name: "",
    sandboxProfileId: initialSandboxProfileId ?? "",
    primaryRepositoryId: "",
    enabled: true,
    inputTemplate: webhookValues.inputTemplate,
    instructions: webhookValues.instructions,
    conversationKeyTemplate: webhookValues.conversationKeyTemplate,
    triggerIds: webhookValues.triggerIds,
    triggerParameterValues: webhookValues.triggerParameterValues,
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

function toWebhookValues(values: CreateAutomationFormValues): WebhookAutomationFormValues {
  return {
    name: values.name,
    sandboxProfileId: values.sandboxProfileId,
    primaryRepositoryId: values.primaryRepositoryId,
    enabled: values.enabled,
    inputTemplate: values.inputTemplate,
    instructions: values.instructions,
    conversationKeyTemplate: values.conversationKeyTemplate,
    triggerIds: values.triggerIds,
    triggerParameterValues: values.triggerParameterValues,
  };
}

function toScheduledValues(values: CreateAutomationFormValues): ScheduledAutomationFormValues {
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
  kind: AutomationTypeValue | null,
  fieldErrors: Partial<Record<CreateAutomationFormValueKey, string>>,
): boolean {
  if (
    fieldErrors.automationType !== undefined ||
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

  return fieldErrors.triggerIds === RequiredTriggerSelectionMessage;
}

function resolvePrimaryRepositorySelectionNormalization(input: {
  currentValues: CreateAutomationFormValues;
  selectedProfileId: string;
  hasLoadedAutomationConfig: boolean;
  primaryRepositoryOptions: readonly { value: string }[];
}): string | null {
  if (!input.hasLoadedAutomationConfig) {
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
    : WebhookAutomationWorkspaceRootRepositoryOptionValue;
}

function resolveNormalizedConversationKeyTemplate(input: {
  values: CreateAutomationFormValues;
  eventOptions: readonly WebhookAutomationEventOption[];
}): string {
  const formState = resolveWebhookAutomationFormState({
    webhookEventOptions: input.eventOptions,
    selectedTriggerIds: input.values.triggerIds,
    conversationKeyTemplate: input.values.conversationKeyTemplate,
    triggerParameterValues: input.values.triggerParameterValues,
    triggerIdsError: undefined,
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

function applyTriggerIdsChange(input: {
  values: CreateAutomationFormValues;
  triggerIds: string[];
  eventOptions: readonly WebhookAutomationEventOption[];
  triggerParameterValuesByEventType?: WebhookAutomationFormValues["triggerParameterValues"];
}): CreateAutomationFormValues {
  const nextValues: CreateAutomationFormValues = {
    ...input.values,
    triggerIds: input.triggerIds,
    triggerParameterValues: Object.fromEntries(
      input.triggerIds.map((triggerId) => {
        const eventOption = input.eventOptions.find((option) => option.id === triggerId);
        const templateParameterValues =
          eventOption === undefined
            ? undefined
            : input.triggerParameterValuesByEventType?.[eventOption.eventType];

        return [
          triggerId,
          templateParameterValues ?? input.values.triggerParameterValues[triggerId] ?? {},
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

function resolveDefaultInputTemplate(kind: AutomationTypeValue): string {
  return kind === "scheduled"
    ? toScheduledAutomationFormValues(null).inputTemplate
    : toWebhookAutomationFormValues(null).inputTemplate;
}

function resolveCreateAutomationMutationErrorMessage(input: {
  error: unknown;
  fallbackMessage: string;
}): string {
  return resolveApiErrorMessage({
    error: input.error,
    fallbackMessage: input.fallbackMessage,
  });
}

async function invalidateAutomationsQuery(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: AUTOMATIONS_QUERY_KEY_PREFIX,
  });
}

function useCreateAutomationEditorState(input: CreateAutomationEditorProps) {
  const queryClient = useQueryClient();
  const initialTemplate =
    input.initialTemplateId === undefined ? null : getTriggerTemplateById(input.initialTemplateId);
  const [kind, setKind] = useState<AutomationTypeValue | null>(initialTemplate?.kind ?? null);
  const [formValues, setFormValues] = useState<CreateAutomationFormValues>(() =>
    createInitialCreateAutomationFormValues(input.initialSandboxProfileId, initialTemplate),
  );
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(
    initialTemplate?.kind === "scheduled" ? (input.initialTemplateId ?? null) : null,
  );
  const [selectedSandboxProfileVersion, setSelectedSandboxProfileVersion] =
    useState<SelectedSandboxProfileVersion | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<CreateAutomationFormValueKey, string>>
  >({});
  const [validationSummaryError, setValidationSummaryError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const sandboxProfilePrerequisites = useAutomationSandboxProfileOptions();
  const eventPrerequisites = useWebhookAutomationEventPrerequisites({
    enabled: kind === "trigger",
  });
  const selectedProfileId = formValues.sandboxProfileId.trim();
  const isUsingPinnedSelectedProfileVersion =
    selectedSandboxProfileVersion?.profileId === selectedProfileId;
  const selectedProfileVersionsQuery = useQuery({
    queryKey: sandboxProfileVersionsQueryKey(selectedProfileId),
    queryFn: async ({ signal }) =>
      listSandboxProfileVersions({
        profileId: selectedProfileId,
        signal,
      }),
    enabled: selectedProfileId.length > 0 && !isUsingPinnedSelectedProfileVersion,
    retry: false,
  });
  const activeSelectedProfileVersion = useMemo(
    () => resolveActiveVersion(selectedProfileVersionsQuery.data?.versions ?? []),
    [selectedProfileVersionsQuery.data],
  );
  const effectiveSelectedProfileVersion = isUsingPinnedSelectedProfileVersion
    ? selectedSandboxProfileVersion.version
    : activeSelectedProfileVersion;
  const hasActiveProfileVersion =
    selectedProfileId.length === 0
      ? null
      : isUsingPinnedSelectedProfileVersion
        ? true
        : selectedProfileVersionsQuery.data === undefined
          ? null
          : activeSelectedProfileVersion !== null;
  const selectedProfileAutomationConfigQuery = useQuery({
    queryKey: sandboxProfileVersionAutomationConfigQueryKey({
      profileId: selectedProfileId,
      version: effectiveSelectedProfileVersion ?? MissingProfileVersionQueryId,
    }),
    queryFn: async ({ signal }) => {
      if (effectiveSelectedProfileVersion === null) {
        throw new Error("No sandbox profile version is available for this profile.");
      }

      return getSandboxProfileVersionAutomationConfig({
        profileId: selectedProfileId,
        version: effectiveSelectedProfileVersion,
        signal,
      });
    },
    enabled: selectedProfileId.length > 0 && effectiveSelectedProfileVersion !== null,
    retry: false,
  });
  const selectedProfileAutomationConfig = selectedProfileAutomationConfigQuery.data;
  const hasLoadedSelectedProfileAutomationConfig = selectedProfileAutomationConfig !== undefined;
  const selectedProfileRepositoryOptions = selectedProfileAutomationConfig?.repositoryOptions ?? [];
  const primaryRepositoryOptions = useMemo(
    () =>
      buildWebhookAutomationPrimaryRepositoryOptions({
        repositoryOptions: selectedProfileRepositoryOptions,
      }),
    [selectedProfileRepositoryOptions],
  );
  const selectedProfileBindingsError = isUsingPinnedSelectedProfileVersion
    ? selectedProfileAutomationConfigQuery.error
    : (selectedProfileVersionsQuery.error ?? selectedProfileAutomationConfigQuery.error);
  const selectedProfileBindingsErrorMessage =
    selectedProfileBindingsError === null
      ? null
      : resolveApiErrorMessage({
          error: selectedProfileBindingsError,
          fallbackMessage: "Could not load profile bindings.",
        });
  const selectedProfileName = sandboxProfilePrerequisites.sandboxProfileOptions.find(
    (option) => option.value === selectedProfileId,
  )?.label;
  const selectedProfileTriggerState = useMemo(
    () =>
      resolveSelectedProfileTriggerState({
        selectedProfileId,
        selectedProfileName,
        hasActiveProfileVersion,
        hasBindingData: hasLoadedSelectedProfileAutomationConfig,
        isBindingDataPending:
          selectedProfileId.length > 0 &&
          ((isUsingPinnedSelectedProfileVersion ? false : selectedProfileVersionsQuery.isPending) ||
            (effectiveSelectedProfileVersion !== null &&
              selectedProfileAutomationConfigQuery.isPending)),
        bindingErrorMessage: selectedProfileBindingsErrorMessage,
        bindings: selectedProfileAutomationConfig?.bindings ?? [],
        directoryData: eventPrerequisites.directoryData ?? {
          connections: [],
          targets: [],
          webhookSources: [],
        },
      }),
    [
      effectiveSelectedProfileVersion,
      hasActiveProfileVersion,
      hasLoadedSelectedProfileAutomationConfig,
      isUsingPinnedSelectedProfileVersion,
      eventPrerequisites.directoryData,
      selectedProfileAutomationConfig,
      selectedProfileAutomationConfigQuery.isPending,
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
        : buildWebhookAutomationEventOptions({
            connections: eventPrerequisites.directoryData.connections,
            targets: eventPrerequisites.directoryData.targets,
            webhookSources: eventPrerequisites.directoryData.webhookSources,
            selectableConnectionIds: selectedProfileTriggerState.selectableConnectionIds,
            selectedTriggerIds: formValues.triggerIds,
          }),
    [
      formValues.triggerIds,
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
      !hasLoadedSelectedProfileAutomationConfig
    ) {
      return;
    }

    const templateTriggerIds = resolveTriggerTemplateEventOptionIds({
      template: initialTemplate,
      eventOptions: webhookEventOptions,
    });
    if (templateTriggerIds === null) {
      setAppliedTemplateId(input.initialTemplateId);
      return;
    }

    setFormValues((currentValues) =>
      applyTriggerIdsChange({
        values: currentValues,
        triggerIds: templateTriggerIds,
        eventOptions: webhookEventOptions,
        ...(initialTemplate.triggerParameterValuesByEventType === undefined
          ? {}
          : {
              triggerParameterValuesByEventType: initialTemplate.triggerParameterValuesByEventType,
            }),
      }),
    );
    setAppliedTemplateId(input.initialTemplateId);
  }, [
    appliedTemplateId,
    eventPrerequisites.directoryData,
    eventPrerequisites.isPending,
    hasLoadedSelectedProfileAutomationConfig,
    initialTemplate,
    input.initialTemplateId,
    webhookEventOptions,
  ]);

  useEffect(() => {
    setFormValues((currentValues) => {
      const normalizedPrimaryRepositoryId = resolvePrimaryRepositorySelectionNormalization({
        currentValues,
        selectedProfileId,
        hasLoadedAutomationConfig: hasLoadedSelectedProfileAutomationConfig,
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
    hasLoadedSelectedProfileAutomationConfig,
    selectedProfileAutomationConfig,
    selectedProfileId,
  ]);

  const createWebhookMutation = useMutation({
    mutationFn: async (values: WebhookAutomationFormValues) =>
      createWebhookAutomation({
        payload: toCreateWebhookAutomationPayload(values, webhookEventOptions),
      }),
    onSuccess: async (automation) => {
      setSelectedSandboxProfileVersion({
        profileId: automation.target.sandboxProfileId,
        version: automation.target.sandboxProfileVersion,
      });
      setValidationSummaryError(null);
      setFormError(null);
      await invalidateAutomationsQuery(queryClient);
      await input.navigate(
        input.createSuccessPath === undefined
          ? `/automations/${automation.id}`
          : input.createSuccessPath(automation),
      );
    },
    onError: (error: unknown) => {
      setFormError(
        resolveCreateAutomationMutationErrorMessage({
          error,
          fallbackMessage: "Could not create trigger.",
        }),
      );
    },
  });
  const createScheduledMutation = useMutation({
    mutationFn: async (values: ScheduledAutomationFormValues) =>
      createScheduledAutomation({
        payload: toCreateScheduledAutomationPayload(values),
      }),
    onSuccess: async (automation) => {
      setSelectedSandboxProfileVersion({
        profileId: automation.target.sandboxProfileId,
        version: automation.target.sandboxProfileVersion,
      });
      setValidationSummaryError(null);
      setFormError(null);
      await invalidateAutomationsQuery(queryClient);
      await input.navigate(
        input.createSuccessPath === undefined
          ? `/automations/schedules/${automation.id}`
          : input.createSuccessPath(automation),
      );
    },
    onError: (error: unknown) => {
      setFormError(
        resolveCreateAutomationMutationErrorMessage({
          error,
          fallbackMessage: "Could not create trigger.",
        }),
      );
    },
  });

  function onKindChange(nextKind: AutomationTypeValue): void {
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
      const { automationType: _automationType, ...remainingErrors } = currentErrors;

      void _automationType;

      return remainingErrors;
    });
    setValidationSummaryError(null);
    setFormError(null);
  }

  function onCommonValueChange(
    key: keyof CommonCreateAutomationFormValues,
    value: string | boolean,
  ) {
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
          triggerIds: _triggerIds,
          conversationKeyTemplate: _conversationKeyTemplate,
          ...remainingErrors
        } = currentErrors;

        void _sandboxProfileId;
        void _primaryRepositoryId;
        void _triggerIds;
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
    key: "conversationKeyTemplate" | "triggerIds" | "triggerParameterValues",
    value: string | string[] | WebhookAutomationFormValues["triggerParameterValues"],
  ) {
    setFormValues((currentValues) => {
      if (key === "triggerIds") {
        return applyTriggerIdsChange({
          values: currentValues,
          triggerIds: Array.isArray(value) ? value : currentValues.triggerIds,
          eventOptions: webhookEventOptions,
        });
      }

      const nextValues = {
        ...currentValues,
        [key]: value,
      };

      if (key === "triggerParameterValues") {
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
      if (key === "triggerIds") {
        const {
          triggerIds: _triggerIds,
          conversationKeyTemplate: _conversationKeyTemplate,
          ...remainingErrors
        } = currentErrors;

        void _triggerIds;
        void _conversationKeyTemplate;

        return remainingErrors;
      }

      if (key === "conversationKeyTemplate") {
        const { conversationKeyTemplate: _conversationKeyTemplate, ...remainingErrors } =
          currentErrors;

        void _conversationKeyTemplate;

        return remainingErrors;
      }

      const { triggerParameterValues: _triggerParameterValues, ...remainingErrors } = currentErrors;

      void _triggerParameterValues;

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
    const nextFieldErrors: Partial<Record<CreateAutomationFormValueKey, string>> =
      kind === null
        ? { automationType: RequiredAutomationTypeSelectionMessage }
        : kind === "scheduled"
          ? validateScheduledAutomationFormValues(toScheduledValues(formValues))
          : validateWebhookAutomationFormValues(toWebhookValues(formValues), webhookEventOptions);
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
    sandboxProfileOptions: sandboxProfilePrerequisites.sandboxProfileOptions,
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
  kind: AutomationTypeValue;
  formState: ReturnType<typeof resolveWebhookAutomationFormState>;
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

export function CreateAutomationEditor(
  input: CreateAutomationEditorProps,
): React.JSX.Element | null {
  const state = useCreateAutomationEditorState(input);
  const presentation = resolveScheduledAutomationFormPresentation({
    mode: "create",
    values: state.formValues,
    primaryRepositoryOptions: state.primaryRepositoryOptions,
  });
  const formState = resolveWebhookAutomationFormState({
    webhookEventOptions: state.webhookEventOptions,
    selectedTriggerIds: state.formValues.triggerIds,
    conversationKeyTemplate: state.formValues.conversationKeyTemplate,
    triggerParameterValues: state.formValues.triggerParameterValues,
    triggerIdsError: state.fieldErrors.triggerIds,
  });

  if (state.isPending) {
    return null;
  }

  return (
    <AutomationFormShell
      automationTypeField={
        <AutomationTypeSelectField
          error={state.fieldErrors.automationType}
          onValueChange={state.onKindChange}
          value={state.kind}
        />
      }
      enabled={state.formValues.enabled}
      fieldErrors={state.fieldErrors}
      formError={state.formError}
      inputIdPrefix="automation"
      inputTemplate={state.formValues.inputTemplate}
      inputTemplateDescription={
        state.kind === null
          ? ""
          : renderInputTemplateDescription({
              kind: state.kind,
              formState,
            })
      }
      inputTemplateLabelId="automation-input-template-label"
      {...(state.kind === "trigger"
        ? { inputTemplatePlaceholderText: DefaultWebhookAutomationMessageTemplate }
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
      shouldShowAutomationEnabledField={presentation.shouldShowAutomationEnabledField}
      shouldShowCreateNameField={presentation.shouldShowCreateNameField}
      shouldShowMessageSection={state.kind !== null}
      shouldShowPrimaryRepositoryField={presentation.shouldShowPrimaryRepositoryField}
      submitLabel={presentation.submitLabel}
      validationSummaryError={state.validationSummaryError}
      extraSectionsBeforeMessage={
        state.kind === "trigger" ? (
          <WebhookAutomationInstructionsSection
            disabled={state.isSaving}
            instructionsLabelId="automation-instructions-label"
            onValueChange={state.onWebhookInstructionsChange}
            value={state.formValues.instructions}
          />
        ) : undefined
      }
      typeSpecificSection={
        state.kind === null ? null : state.kind === "scheduled" ? (
          <ScheduledAutomationTypeSpecificSection
            fieldErrors={state.fieldErrors}
            isDeleting={false}
            isSaving={state.isSaving}
            onValueChange={state.onScheduledValueChange}
            values={state.formValues}
          />
        ) : (
          <WebhookAutomationTypeSpecificSection
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
