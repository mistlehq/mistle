import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import { Field, FieldContent, FieldDescription, FieldHeader, FieldLabel } from "@mistle/ui";
import { useEffect, useRef, useState } from "react";

import {
  clearPendingStatusTimeouts,
  getErrorMessage,
  scheduleSavedStateReset,
  type AutoSaveErrorState,
} from "../shared/auto-save-behavior.js";
import {
  AutoSaveInputSurface,
  type AutoSaveInputVisualStatus,
} from "../shared/auto-save-input-surface.js";

type AutoSaveStatus = AutoSaveInputVisualStatus;
export type AutoSaveTextFieldErrorState = AutoSaveErrorState;

export type AutoSaveTextFieldProps = {
  id: string;
  label: string;
  value: string;
  description?: string;
  placeholder?: string;
  disabled?: boolean;
  validate: (nextValue: string) => string | null;
  onSave: (nextValue: string) => Promise<void>;
  successVisibleDurationMs?: number;
  successFadeDurationMs?: number;
  scheduler?: Scheduler;
};

export function AutoSaveTextField(input: AutoSaveTextFieldProps): React.JSX.Element {
  const successVisibleDurationMs = input.successVisibleDurationMs ?? 2200;
  const successFadeDurationMs = input.successFadeDurationMs ?? 700;
  const scheduler = input.scheduler ?? systemScheduler;
  const [draftValue, setDraftValue] = useState(input.value);
  const [errorState, setErrorState] = useState<AutoSaveTextFieldErrorState | null>(null);
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

    if (!preserveStatus) {
      saveSequenceRef.current += 1;
      clearPendingStatusTimeouts({
        fadeEndTimeoutRef,
        fadeStartTimeoutRef,
        scheduler,
      });
      setErrorState(null);
      setStatus("idle");
    }

    setDraftValue(input.value);
  }, [draftValue, input.value, scheduler, status]);

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
    if (input.disabled || status === "saving") {
      return;
    }

    if (draftValue.trim() === input.value.trim()) {
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
      await input.onSave(draftValue);

      if (saveSequenceRef.current !== currentSaveSequence) {
        return;
      }

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

      setStatus("idle");
      setErrorState({
        kind: "save",
        message: getErrorMessage(error),
      });
    }
  }

  const showStatus = status !== "idle" || errorState !== null;

  return (
    <Field contentWidth="fill" orientation="horizontal">
      <FieldHeader>
        <FieldLabel htmlFor={input.id}>{input.label}</FieldLabel>
        {input.description === undefined ? null : (
          <FieldDescription>{input.description}</FieldDescription>
        )}
      </FieldHeader>
      <FieldContent>
        <AutoSaveInputSurface
          ariaLabel={input.label}
          disabled={input.disabled === true || status === "saving"}
          id={input.id}
          onBlur={() => {
            void handleCommit();
          }}
          onChange={(nextValue) => {
            setDraftValue(nextValue);
            if (errorState !== null || status !== "idle") {
              setErrorState(null);
              setStatus("idle");
              clearPendingStatusTimeouts({
                fadeEndTimeoutRef,
                fadeStartTimeoutRef,
                scheduler,
              });
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          saveStatus={showStatus && errorState === null ? status : "idle"}
          value={draftValue}
          {...(errorState === null ? {} : { errorMessage: errorState.message })}
          {...(input.placeholder === undefined ? {} : { placeholder: input.placeholder })}
        />
      </FieldContent>
    </Field>
  );
}
