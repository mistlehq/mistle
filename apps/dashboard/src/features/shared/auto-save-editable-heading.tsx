import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import { useEffect, useRef, useState } from "react";

import {
  clearPendingStatusTimeouts,
  getErrorMessage,
  scheduleSavedStateReset,
  type AutoSaveErrorState,
} from "./auto-save-behavior.js";
import type { AutoSaveInputVisualStatus } from "./auto-save-input-surface.js";
import { EditableHeading } from "./editable-heading.js";

type AutoSaveStatus = AutoSaveInputVisualStatus;

export type AutoSaveEditableHeadingProps = {
  initialValue: string;
  ariaLabel: string;
  editButtonLabel: string;
  placeholder?: string;
  maxWidthClassName?: string;
  headingTag?: "div" | "h1" | "h2";
  headingClassName?: string;
  inputClassName?: string;
  cancelOnEscape?: boolean;
  initiallyEditing?: boolean;
  initialErrorState?: AutoSaveErrorState | null;
  validate: (nextValue: string) => string | null;
  onSave: (nextValue: string) => Promise<void>;
  successVisibleDurationMs?: number;
  successFadeDurationMs?: number;
  scheduler?: Scheduler;
};

export function AutoSaveEditableHeading(input: AutoSaveEditableHeadingProps): React.JSX.Element {
  const successVisibleDurationMs = input.successVisibleDurationMs ?? 2200;
  const successFadeDurationMs = input.successFadeDurationMs ?? 700;
  const scheduler = input.scheduler ?? systemScheduler;
  const [isEditing, setIsEditing] = useState(
    input.initiallyEditing ?? input.initialErrorState != null,
  );
  const [draftValue, setDraftValue] = useState(input.initialValue);
  const [value, setValue] = useState(input.initialValue);
  const [errorState, setErrorState] = useState<AutoSaveErrorState | null>(
    input.initialErrorState ?? null,
  );
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const saveSequenceRef = useRef(0);
  const fadeStartTimeoutRef = useRef<TimerHandle | null>(null);
  const fadeEndTimeoutRef = useRef<TimerHandle | null>(null);

  useEffect(() => {
    setIsEditing(input.initiallyEditing ?? input.initialErrorState != null);
    setDraftValue(input.initialValue);
    setValue(input.initialValue);
    setErrorState(input.initialErrorState ?? null);
    setStatus("idle");
  }, [input.initialErrorState, input.initialValue, input.initiallyEditing]);

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
    if (status === "saving") {
      return;
    }

    if (draftValue === value) {
      setErrorState(null);
      setStatus("idle");
      setIsEditing(false);
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

      setValue(draftValue);
      setStatus("saved");
      scheduleSavedStateReset({
        fadeEndTimeoutRef,
        fadeStartTimeoutRef,
        onFadeEnd: () => {
          setStatus("idle");
          setIsEditing(false);
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
    <EditableHeading
      ariaLabel={input.ariaLabel}
      cancelOnEscape={input.cancelOnEscape}
      draftValue={draftValue}
      editButtonLabel={input.editButtonLabel}
      errorMessage={errorState?.message}
      {...(input.headingClassName === undefined
        ? {}
        : { headingClassName: input.headingClassName })}
      {...(input.headingTag === undefined ? {} : { headingTag: input.headingTag })}
      {...(input.inputClassName === undefined ? {} : { inputClassName: input.inputClassName })}
      isEditing={isEditing}
      maxWidthClassName={input.maxWidthClassName}
      onCancel={() => {
        clearPendingStatusTimeouts({
          fadeEndTimeoutRef,
          fadeStartTimeoutRef,
          scheduler,
        });
        setDraftValue(value);
        setErrorState(null);
        setStatus("idle");
        setIsEditing(false);
      }}
      onCommit={() => {
        void handleCommit();
      }}
      onDraftValueChange={(nextValue) => {
        setDraftValue(nextValue);
        if (errorState !== null) {
          setErrorState(null);
        }
      }}
      onEditStart={() => {
        clearPendingStatusTimeouts({
          fadeEndTimeoutRef,
          fadeStartTimeoutRef,
          scheduler,
        });
        setDraftValue(value);
        setErrorState(null);
        setStatus("idle");
        setIsEditing(true);
      }}
      placeholder={input.placeholder}
      saveDisabled={status === "saving"}
      saveStatus={showStatus && errorState === null ? status : "idle"}
      value={value}
    />
  );
}
