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
  initialValue: string;
  initialErrorState?: AutoSaveTextFieldErrorState | null;
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
  const [draftValue, setDraftValue] = useState(input.initialValue);
  const [committedValue, setCommittedValue] = useState(input.initialValue);
  const [errorState, setErrorState] = useState<AutoSaveTextFieldErrorState | null>(
    input.initialErrorState ?? null,
  );
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const saveSequenceRef = useRef(0);
  const fadeStartTimeoutRef = useRef<TimerHandle | null>(null);
  const fadeEndTimeoutRef = useRef<TimerHandle | null>(null);

  useEffect(() => {
    setDraftValue(input.initialValue);
    setCommittedValue(input.initialValue);
    setErrorState(input.initialErrorState ?? null);
    setStatus("idle");
  }, [input.initialErrorState, input.initialValue]);

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
    if (input.disabled || status === "saving" || draftValue === committedValue) {
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

      setCommittedValue(draftValue);
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
          id={input.id}
          onBlur={() => {
            void handleCommit();
          }}
          onChange={(nextValue) => {
            setDraftValue(nextValue);
            if (errorState !== null) {
              setErrorState(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          saveStatus={showStatus && errorState === null ? status : "idle"}
          value={draftValue}
          {...(input.disabled === undefined ? {} : { disabled: input.disabled })}
          {...(errorState === null ? {} : { errorMessage: errorState.message })}
          {...(input.placeholder === undefined ? {} : { placeholder: input.placeholder })}
        />
      </FieldContent>
    </Field>
  );
}
