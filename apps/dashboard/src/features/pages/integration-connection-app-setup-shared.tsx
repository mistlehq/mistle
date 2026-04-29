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

type ExistingAppSetupAutoSaveFieldInput<FieldKey extends string> = {
  fieldKey: FieldKey;
  draft: Record<FieldKey, string>;
};

export type SetupFieldFeedback<FieldKey extends string> = {
  fieldStates: ReadonlyMap<FieldKey, SavingFieldState>;
  markFieldSavedWithReset: (fieldKey: FieldKey) => void;
  resetFieldFeedback: (fieldKey: FieldKey) => void;
  setFieldError: (fieldKey: FieldKey, errorMessage: string) => void;
  setFieldSaving: (fieldKey: FieldKey) => void;
};

export type ExistingAppSetupAutoSave<FieldKey extends string> = {
  draft: Record<FieldKey, string>;
  fieldStates: ReadonlyMap<FieldKey, SavingFieldState>;
  persistField: (fieldKey: FieldKey) => Promise<void>;
  revertField: (fieldKey: FieldKey) => void;
  savedDraft: Record<FieldKey, string>;
  updateFieldDraft: (fieldKey: FieldKey, nextValue: string) => void;
};

type ExistingAppSetupAutoSaveInput<FieldKey extends string, SaveResult> = {
  clearActionError: () => void;
  createInitialDraft: () => Record<FieldKey, string>;
  fieldKeys: readonly FieldKey[];
  normalizeValue: (value: string) => string;
  onFieldSaved?: (saveResult: SaveResult, fieldKey: FieldKey) => void;
  resolveSavedFieldKeys: (fieldKey: FieldKey) => readonly FieldKey[];
  resolveSaveErrorMessage: (error: unknown) => string;
  saveField: (saveInput: ExistingAppSetupAutoSaveFieldInput<FieldKey>) => Promise<SaveResult>;
  shouldPersistField?: (fieldInput: ExistingAppSetupAutoSaveFieldInput<FieldKey>) => boolean;
  validateField?: (fieldInput: ExistingAppSetupAutoSaveFieldInput<FieldKey>) => string | null;
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

export function useExistingAppSetupAutoSave<FieldKey extends string, SaveResult>(
  input: ExistingAppSetupAutoSaveInput<FieldKey, SaveResult>,
): ExistingAppSetupAutoSave<FieldKey> {
  const [draft, setDraft] = useState(input.createInitialDraft);
  const [savedDraft, setSavedDraft] = useState(input.createInitialDraft);
  const fieldFeedback = useSetupFieldFeedback(input.fieldKeys);

  function updateFieldDraft(fieldKey: FieldKey, nextValue: string): void {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [fieldKey]: nextValue,
    }));
    input.clearActionError();
    const fieldState = getSetupFieldState(fieldFeedback.fieldStates, fieldKey);
    if (fieldState.status !== "idle" || fieldState.errorMessage !== null) {
      fieldFeedback.resetFieldFeedback(fieldKey);
    }
  }

  async function persistField(fieldKey: FieldKey): Promise<void> {
    if (getSetupFieldState(fieldFeedback.fieldStates, fieldKey).status === "saving") {
      return;
    }

    if (
      !isExistingAppSetupFieldDirty({
        fieldKey,
        draft,
        savedDraft,
        normalizeValue: input.normalizeValue,
      })
    ) {
      setDraft((currentDraft) => ({
        ...currentDraft,
        [fieldKey]: savedDraft[fieldKey],
      }));
      fieldFeedback.resetFieldFeedback(fieldKey);
      return;
    }

    const validationMessage =
      input.validateField?.({
        fieldKey,
        draft,
      }) ?? null;
    if (validationMessage !== null) {
      fieldFeedback.setFieldError(fieldKey, validationMessage);
      return;
    }

    const shouldPersist =
      input.shouldPersistField?.({
        fieldKey,
        draft,
      }) ?? true;
    if (!shouldPersist) {
      fieldFeedback.resetFieldFeedback(fieldKey);
      return;
    }

    fieldFeedback.setFieldSaving(fieldKey);

    try {
      const saveResult = await input.saveField({
        draft,
        fieldKey,
      });
      const savedFieldValuePatch = buildSavedFieldValuePatch({
        draft,
        fieldKeys: input.resolveSavedFieldKeys(fieldKey),
        normalizeValue: input.normalizeValue,
      });
      const nextSavedDraft = {
        ...savedDraft,
        ...savedFieldValuePatch,
      };
      const nextDraft = {
        ...draft,
        ...savedFieldValuePatch,
      };

      setSavedDraft(nextSavedDraft);
      setDraft(nextDraft);
      input.onFieldSaved?.(saveResult, fieldKey);
      input.clearActionError();
      fieldFeedback.markFieldSavedWithReset(fieldKey);
    } catch (error) {
      fieldFeedback.setFieldError(fieldKey, input.resolveSaveErrorMessage(error));
    }
  }

  function revertField(fieldKey: FieldKey): void {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [fieldKey]: "",
    }));
    fieldFeedback.resetFieldFeedback(fieldKey);
  }

  return {
    draft,
    fieldStates: fieldFeedback.fieldStates,
    persistField,
    revertField,
    savedDraft,
    updateFieldDraft,
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

function buildSavedFieldValuePatch<FieldKey extends string>(input: {
  draft: Record<FieldKey, string>;
  fieldKeys: readonly FieldKey[];
  normalizeValue: (value: string) => string;
}): Partial<Record<FieldKey, string>> {
  const patch: Partial<Record<FieldKey, string>> = {};

  for (const fieldKey of input.fieldKeys) {
    patch[fieldKey] = input.normalizeValue(input.draft[fieldKey]);
  }

  return patch;
}

function isExistingAppSetupFieldDirty<FieldKey extends string>(input: {
  draft: Record<FieldKey, string>;
  fieldKey: FieldKey;
  normalizeValue: (value: string) => string;
  savedDraft: Record<FieldKey, string>;
}): boolean {
  return (
    input.normalizeValue(input.draft[input.fieldKey]) !==
    input.normalizeValue(input.savedDraft[input.fieldKey])
  );
}
