import { systemScheduler } from "@mistle/time";
import { useEffect, useRef, useState } from "react";

import {
  ConfiguredSecretField,
  SavingTextField,
  type SavingFieldState,
} from "../forms/configured-secret-field.js";
import { createManifestJsonDraft } from "../integrations/manifest-json-editor.js";
import type { ManifestWebhookCallbackState } from "../integrations/manifest-webhook-callback-state.js";
import {
  type AutoSaveFieldTimeoutRefs,
  clearPendingStatusTimeouts,
  createAutoSaveFieldTimeoutRefs,
  resolveAutoSaveFieldTimeoutRefs,
  scheduleSavedStateReset,
} from "../shared/auto-save-behavior.js";
import { SectionHeader } from "../shared/section-header.js";
import {
  type IntegrationSetupAppManifestDraftBuilder,
  resolveManifestDraftControlPlaneBaseUrl,
} from "./integration-connection-setup-manifest-draft.js";

type ExistingAppSetupTextField<FieldKey extends string> = {
  fieldKey: FieldKey;
  id: string;
  label: string;
  required?: boolean;
  value: string;
};

type ExistingAppSetupSecretField<SecretFieldKey extends string> = {
  fieldKey: SecretFieldKey;
  id: string;
  label: string;
  secretLabel: string;
  value: string;
  configured: boolean;
  required?: boolean;
  placeholder?: string;
  rows?: number;
  type?: "password";
  multiline?: boolean;
};

export type SetupFieldFeedback<FieldKey extends string> = {
  fieldStates: ReadonlyMap<FieldKey, SavingFieldState>;
  markFieldSavedWithReset: (fieldKey: FieldKey) => void;
  resetFieldFeedback: (fieldKey: FieldKey) => void;
  setFieldError: (fieldKey: FieldKey, errorMessage: string) => void;
  setFieldSaving: (fieldKey: FieldKey) => void;
};

export function useSetupFieldFeedback<FieldKey extends string>(
  fieldKeys: readonly FieldKey[],
): SetupFieldFeedback<FieldKey> {
  const [fieldStates, setFieldStates] = useState(() => createInitialFieldStates(fieldKeys));
  const fieldTimeoutRefs = useRef(
    createAutoSaveFieldTimeoutRefs({
      fieldKeys,
    }),
  );

  useEffect(() => {
    return () => {
      for (const fieldKey of fieldKeys) {
        const timeoutRefs = resolveAutoSaveFieldTimeoutRefs({
          timeoutRefs: fieldTimeoutRefs.current,
          fieldKey,
        });
        clearPendingStatusTimeouts({
          fadeEndTimeoutRef: timeoutRefs.fadeEndTimeoutRef,
          fadeStartTimeoutRef: timeoutRefs.fadeStartTimeoutRef,
          scheduler: systemScheduler,
        });
      }
    };
  }, [fieldKeys]);

  function resetFieldFeedback(fieldKey: FieldKey): void {
    clearFieldStatusTimeouts(fieldTimeoutRefs.current, fieldKey);
    setFieldStates((currentFieldStates) =>
      setSavingFieldState(currentFieldStates, fieldKey, {
        status: "idle",
        errorMessage: null,
      }),
    );
  }

  function setFieldSaving(fieldKey: FieldKey): void {
    clearFieldStatusTimeouts(fieldTimeoutRefs.current, fieldKey);
    setFieldStates((currentFieldStates) =>
      setSavingFieldState(currentFieldStates, fieldKey, {
        status: "saving",
        errorMessage: null,
      }),
    );
  }

  function setFieldError(fieldKey: FieldKey, errorMessage: string): void {
    clearFieldStatusTimeouts(fieldTimeoutRefs.current, fieldKey);
    setFieldStates((currentFieldStates) =>
      setSavingFieldState(currentFieldStates, fieldKey, {
        status: "idle",
        errorMessage,
      }),
    );
  }

  function markFieldSavedWithReset(fieldKey: FieldKey): void {
    const timeoutRefs = resolveAutoSaveFieldTimeoutRefs({
      timeoutRefs: fieldTimeoutRefs.current,
      fieldKey,
    });
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef: timeoutRefs.fadeEndTimeoutRef,
      fadeStartTimeoutRef: timeoutRefs.fadeStartTimeoutRef,
      scheduler: systemScheduler,
    });
    setFieldStates((currentFieldStates) =>
      setSavingFieldState(currentFieldStates, fieldKey, {
        status: "saved",
        errorMessage: null,
      }),
    );
    scheduleSavedStateReset({
      fadeEndTimeoutRef: timeoutRefs.fadeEndTimeoutRef,
      fadeStartTimeoutRef: timeoutRefs.fadeStartTimeoutRef,
      onFadeEnd: () => {
        setFieldStates((currentFieldStates) =>
          setSavingFieldState(currentFieldStates, fieldKey, {
            status: "idle",
            errorMessage: null,
          }),
        );
      },
      onFadeStart: () => {
        setFieldStates((currentFieldStates) =>
          setSavingFieldState(currentFieldStates, fieldKey, {
            status: "saved-fading",
            errorMessage: null,
          }),
        );
      },
      scheduler: systemScheduler,
      successFadeDurationMs: 700,
      successVisibleDurationMs: 2200,
    });
  }

  return {
    fieldStates,
    markFieldSavedWithReset,
    resetFieldFeedback,
    setFieldError,
    setFieldSaving,
  };
}

export function getSetupFieldState<FieldKey extends string>(
  fieldStates: ReadonlyMap<FieldKey, SavingFieldState>,
  fieldKey: FieldKey,
): SavingFieldState {
  const fieldState = fieldStates.get(fieldKey);
  if (fieldState === undefined) {
    throw new Error(`Missing setup field state for '${fieldKey}'.`);
  }

  return fieldState;
}

export function useSetupManifestDraft(input: {
  manifestDraftBuilder: IntegrationSetupAppManifestDraftBuilder;
  webhookCallbackState: ManifestWebhookCallbackState;
}): {
  manifestValue: string;
  onManifestChange: (nextValue: string) => void;
} {
  const [manifestValue, setManifestValue] = useState("");
  const [hasEditedManifest, setHasEditedManifest] = useState(false);
  const webhookCallbackUrl =
    input.webhookCallbackState.kind === "ready" ? input.webhookCallbackState.value : null;
  const resolvedManifestValue =
    webhookCallbackUrl === null || hasEditedManifest
      ? manifestValue
      : createManifestJsonDraft(
          input.manifestDraftBuilder({
            controlPlaneBaseUrl: resolveManifestDraftControlPlaneBaseUrl({
              webhookCallbackUrl,
            }),
            webhookCallbackUrl,
          }),
        );

  function onManifestChange(nextValue: string): void {
    setHasEditedManifest(true);
    setManifestValue(nextValue);
  }

  return {
    manifestValue: resolvedManifestValue,
    onManifestChange,
  };
}

export function ExistingAppSetupFieldsPanel<
  FieldKey extends string,
  SecretFieldKey extends FieldKey,
>(input: {
  configFields: readonly ExistingAppSetupTextField<FieldKey>[];
  description: string;
  fieldStates: ReadonlyMap<FieldKey, SavingFieldState>;
  onCommitField: (fieldKey: FieldKey) => void;
  onReplacementDialogOpenChange: (open: boolean) => void;
  onRevertSecretReplacement: (fieldKey: SecretFieldKey) => void;
  onUpdateFieldDraft: (fieldKey: FieldKey, nextValue: string) => void;
  secretFields: readonly ExistingAppSetupSecretField<SecretFieldKey>[];
  title: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <SectionHeader description={input.description} title={input.title} />
        {input.configFields.map((field) => (
          <SavingTextField
            fieldState={getSetupFieldState(input.fieldStates, field.fieldKey)}
            id={field.id}
            key={field.fieldKey}
            label={field.label}
            onBlur={() => {
              input.onCommitField(field.fieldKey);
            }}
            onChange={(nextValue) => {
              input.onUpdateFieldDraft(field.fieldKey, nextValue);
            }}
            {...(field.required === undefined ? {} : { required: field.required })}
            value={field.value}
          />
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <SectionHeader title="Secrets" />
        {input.secretFields.map((field) => (
          <ConfiguredSecretField
            configured={field.configured}
            fieldState={getSetupFieldState(input.fieldStates, field.fieldKey)}
            id={field.id}
            key={field.fieldKey}
            label={field.label}
            {...(field.multiline === undefined ? {} : { multiline: field.multiline })}
            onCancelReplace={() => {
              input.onRevertSecretReplacement(field.fieldKey);
            }}
            onChange={(nextValue) => {
              input.onUpdateFieldDraft(field.fieldKey, nextValue);
            }}
            onCommit={() => {
              input.onCommitField(field.fieldKey);
            }}
            onReplacementDialogOpenChange={input.onReplacementDialogOpenChange}
            {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
            {...(field.required === undefined ? {} : { required: field.required })}
            {...(field.rows === undefined ? {} : { rows: field.rows })}
            secretLabel={field.secretLabel}
            {...(field.type === undefined ? {} : { type: field.type })}
            value={field.value}
          />
        ))}
      </div>
    </div>
  );
}

function createInitialFieldStates<FieldKey extends string>(
  fieldKeys: readonly FieldKey[],
): Map<FieldKey, SavingFieldState> {
  const fieldStates = new Map<FieldKey, SavingFieldState>();
  for (const fieldKey of fieldKeys) {
    fieldStates.set(fieldKey, { status: "idle", errorMessage: null });
  }

  return fieldStates;
}

function setSavingFieldState<FieldKey extends string>(
  currentFieldStates: ReadonlyMap<FieldKey, SavingFieldState>,
  fieldKey: FieldKey,
  fieldState: SavingFieldState,
): Map<FieldKey, SavingFieldState> {
  const nextFieldStates = new Map(currentFieldStates);
  nextFieldStates.set(fieldKey, fieldState);
  return nextFieldStates;
}

function clearFieldStatusTimeouts(
  timeoutRefs: Record<string, AutoSaveFieldTimeoutRefs>,
  fieldKey: string,
): void {
  const fieldTimeoutRefs = resolveAutoSaveFieldTimeoutRefs({
    timeoutRefs,
    fieldKey,
  });
  clearPendingStatusTimeouts({
    fadeEndTimeoutRef: fieldTimeoutRefs.fadeEndTimeoutRef,
    fadeStartTimeoutRef: fieldTimeoutRefs.fadeStartTimeoutRef,
    scheduler: systemScheduler,
  });
}
