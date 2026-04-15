import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import { useEffect, useRef, useState } from "react";

import {
  clearPendingStatusTimeouts,
  getErrorMessage,
  scheduleSavedStateReset,
  type AutoSaveErrorState,
} from "./auto-save-behavior.js";
import type { AutoSaveInputVisualStatus } from "./auto-save-input-surface.js";
import { InlineEditableHeadingField } from "./inline-editable-heading-field.js";

type AutoSaveStatus = AutoSaveInputVisualStatus;

export type AutoSaveInlineHeadingProps = {
  value: string;
  displayText?: string;
  ariaLabel: string;
  disabled?: boolean;
  errorMessage?: string;
  placeholder?: string;
  maxWidthClassName?: string;
  inputClassName?: string;
  cancelOnEscape?: boolean;
  validate: (nextValue: string) => string | null;
  onSave: (nextValue: string) => Promise<void> | void;
  onEditStart?: () => void;
  successVisibleDurationMs?: number;
  successFadeDurationMs?: number;
  scheduler?: Scheduler;
};

export type AutoSaveTitleHeadingProps = Omit<
  AutoSaveInlineHeadingProps,
  "displayText" | "validate" | "value"
> & {
  emptyDisplayText: string;
  requiredLabel: string;
  value: string | null;
};

function useAutoSaveInlineHeadingState(input: AutoSaveInlineHeadingProps): {
  draftValue: string;
  errorState: AutoSaveErrorState | null;
  showStatus: boolean;
  status: AutoSaveStatus;
  onChangeDraft: (nextValue: string) => void;
  onCommit: () => Promise<void>;
  onCancelEdit: () => void;
  onEnterEditMode: () => void;
} {
  const successVisibleDurationMs = input.successVisibleDurationMs ?? 2200;
  const successFadeDurationMs = input.successFadeDurationMs ?? 700;
  const scheduler = input.scheduler ?? systemScheduler;
  const errorMessage = input.errorMessage;
  const [draftValue, setDraftValue] = useState(input.value);
  const [errorState, setErrorState] = useState<AutoSaveErrorState | null>(null);
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const saveSequenceRef = useRef(0);
  const previousValueRef = useRef(input.value);
  const fadeStartTimeoutRef = useRef<TimerHandle | null>(null);
  const fadeEndTimeoutRef = useRef<TimerHandle | null>(null);

  useEffect(() => {
    const previousValue = previousValueRef.current;
    previousValueRef.current = input.value;

    if (input.value === previousValue) {
      return;
    }

    const normalizedIncomingValue = input.value.trim();
    const normalizedDraftValue = draftValue.trim();
    const preserveStatus =
      (status === "saving" || status === "saved" || status === "saved-fading") &&
      normalizedIncomingValue === normalizedDraftValue;

    if (preserveStatus) {
      setDraftValue(input.value);
      setErrorState(null);
      return;
    }

    saveSequenceRef.current += 1;
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    setDraftValue(input.value);
    setErrorState(null);
    setStatus("idle");
  }, [draftValue, input.value, scheduler, status]);

  useEffect(() => {
    if (errorMessage === undefined) {
      return;
    }

    setErrorState({
      kind: "save",
      message: errorMessage,
    });
    setStatus("idle");
  }, [errorMessage]);

  useEffect(() => {
    return () => {
      clearPendingStatusTimeouts({
        fadeEndTimeoutRef,
        fadeStartTimeoutRef,
        scheduler,
      });
    };
  }, [scheduler]);

  async function handleCommit(): Promise<void> {
    if (input.disabled === true || status === "saving") {
      return;
    }

    const normalizedDraftValue = draftValue.trim();
    if (normalizedDraftValue === input.value.trim()) {
      if (errorMessage !== undefined) {
        setErrorState({
          kind: "save",
          message: errorMessage,
        });
        setStatus("idle");
        return;
      }

      setDraftValue(input.value);
      setErrorState(null);
      setStatus("idle");
      return;
    }

    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });

    const validationMessage = input.validate(draftValue);
    if (validationMessage !== null) {
      setErrorState({
        kind: "validation",
        message: validationMessage,
      });
      setStatus("idle");
      return;
    }

    const currentSaveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = currentSaveSequence;
    setErrorState(null);
    setStatus("saving");

    try {
      await input.onSave(normalizedDraftValue);

      if (saveSequenceRef.current !== currentSaveSequence) {
        return;
      }

      setDraftValue(normalizedDraftValue);
      setStatus("saved");
      scheduleSavedStateReset({
        fadeEndTimeoutRef,
        fadeStartTimeoutRef,
        onFadeEnd: () => {
          setStatus("idle");
        },
        onFadeStart: () => {
          setStatus("saved-fading");
        },
        scheduler,
        successFadeDurationMs,
        successVisibleDurationMs,
      });
    } catch (error) {
      if (saveSequenceRef.current !== currentSaveSequence) {
        return;
      }

      setErrorState({
        kind: "save",
        message: getErrorMessage(error),
      });
      setStatus("idle");
    }
  }

  function handleDraftChange(nextValue: string): void {
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    setDraftValue(nextValue);
    setErrorState(null);
    setStatus("idle");
  }

  function handleCancelEdit(): void {
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    setDraftValue(input.value);
    setErrorState(null);
    setStatus("idle");
  }

  function handleEnterEditMode(): void {
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    input.onEditStart?.();
  }

  return {
    draftValue,
    errorState,
    showStatus: status !== "idle" || errorState !== null,
    status,
    onChangeDraft: handleDraftChange,
    onCommit: handleCommit,
    onCancelEdit: handleCancelEdit,
    onEnterEditMode: handleEnterEditMode,
  };
}

export function AutoSaveInlineHeading(input: AutoSaveInlineHeadingProps): React.JSX.Element {
  const heading = useAutoSaveInlineHeadingState(input);
  const liveMessage =
    heading.errorState !== null
      ? ""
      : heading.status === "saving"
        ? "Saving"
        : heading.status === "saved" || heading.status === "saved-fading"
          ? "Saved"
          : "";

  return (
    <>
      <p aria-live="polite" className="sr-only" role="status">
        {liveMessage}
      </p>
      <InlineEditableHeadingField
        ariaLabel={input.ariaLabel}
        autoFocus={false}
        draftValue={heading.draftValue}
        onCancel={heading.onCancelEdit}
        onCommit={() => {
          void heading.onCommit();
        }}
        onDraftValueChange={heading.onChangeDraft}
        onFocus={heading.onEnterEditMode}
        disabled={input.disabled === true || heading.status === "saving"}
        saveStatus={heading.showStatus && heading.errorState === null ? heading.status : "idle"}
        {...(input.cancelOnEscape === undefined ? {} : { cancelOnEscape: input.cancelOnEscape })}
        {...(heading.errorState?.message === undefined
          ? {}
          : { errorMessage: heading.errorState.message })}
        {...(input.inputClassName === undefined ? {} : { inputClassName: input.inputClassName })}
        {...(input.maxWidthClassName === undefined
          ? {}
          : { maxWidthClassName: input.maxWidthClassName })}
        {...(() => {
          const placeholder =
            input.value.trim().length === 0 && input.displayText !== undefined
              ? input.displayText
              : input.placeholder;

          return placeholder === undefined ? {} : { placeholder };
        })()}
      />
    </>
  );
}

export function AutoSaveTitleHeading(input: AutoSaveTitleHeadingProps): React.JSX.Element {
  const { emptyDisplayText, requiredLabel, value, ...editableHeadingProps } = input;
  const normalizedValue = value === null || value.trim().length === 0 ? null : value;

  return (
    <AutoSaveInlineHeading
      displayText={normalizedValue ?? emptyDisplayText}
      validate={(nextValue) => {
        return nextValue.trim().length > 0 ? null : `${requiredLabel} is required.`;
      }}
      value={normalizedValue ?? ""}
      {...editableHeadingProps}
    />
  );
}
