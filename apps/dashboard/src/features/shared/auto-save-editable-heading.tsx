import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import { Button, Notice } from "@mistle/ui";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import {
  clearPendingStatusTimeouts,
  getErrorMessage,
  scheduleSavedStateReset,
  type AutoSaveErrorState,
} from "./auto-save-behavior.js";
import type { AutoSaveInputVisualStatus } from "./auto-save-input-surface.js";
import { PageTitleField } from "./page-title-field.js";

type AutoSaveStatus = AutoSaveInputVisualStatus;

export type AutoSaveEditableHeadingProps = {
  initialValue: string;
  ariaLabel: string;
  editButtonLabel: string;
  disabled?: boolean;
  placeholder?: string;
  maxWidthClassName?: string;
  headingTag?: "div" | "h1" | "h2";
  headingClassName?: string;
  inputClassName?: string;
  cancelOnEscape?: boolean;
  initiallyEditing?: boolean;
  initialErrorState?: AutoSaveErrorState | null;
  validate: (nextValue: string) => string | null;
  onSave: (nextValue: string) => Promise<void> | void;
  successVisibleDurationMs?: number;
  successFadeDurationMs?: number;
  scheduler?: Scheduler;
};

export function AutoSaveEditableHeading(input: AutoSaveEditableHeadingProps): React.JSX.Element {
  const successVisibleDurationMs = input.successVisibleDurationMs ?? 2200;
  const successFadeDurationMs = input.successFadeDurationMs ?? 700;
  const scheduler = input.scheduler ?? systemScheduler;
  const initialErrorKind = input.initialErrorState?.kind ?? null;
  const initialErrorMessage = input.initialErrorState?.message ?? null;
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
    saveSequenceRef.current += 1;
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });
    setIsEditing(input.initiallyEditing ?? input.initialErrorState != null);
    setDraftValue(input.initialValue);
    setValue(input.initialValue);
    setErrorState(input.initialErrorState ?? null);
    setStatus("idle");
  }, [
    initialErrorKind,
    initialErrorMessage,
    input.initialValue,
    input.initiallyEditing,
    scheduler,
  ]);

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
    if (normalizedDraftValue === value.trim()) {
      setErrorState(null);
      setStatus("idle");
      setIsEditing(false);
      setDraftValue(value);
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
      setValue(normalizedDraftValue);
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
  const containerClassName = `w-full ${input.maxWidthClassName ?? "max-w-2xl"} space-y-2`;
  const HeadingTag = input.headingTag ?? "h1";
  const headingClassName = input.headingClassName ?? "text-xl font-semibold leading-none";
  const headingToneClassName = errorState === null ? "" : " text-destructive";

  if (isEditing) {
    return (
      <PageTitleField
        ariaLabel={input.ariaLabel}
        autoFocus={true}
        fieldId="editable-heading-input"
        label={input.ariaLabel}
        disabled={input.disabled === true || status === "saving"}
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
            return;
          }

          if (event.key === "Escape" && (input.cancelOnEscape ?? true)) {
            clearPendingStatusTimeouts({
              fadeEndTimeoutRef,
              fadeStartTimeoutRef,
              scheduler,
            });
            setDraftValue(value);
            setErrorState(null);
            setStatus("idle");
            setIsEditing(false);
          }
        }}
        saveStatus={showStatus && errorState === null ? status : "idle"}
        showLabel={false}
        value={draftValue}
        {...(input.inputClassName === undefined ? {} : { className: input.inputClassName })}
        {...(errorState === null ? {} : { errorMessage: errorState.message })}
        {...(input.maxWidthClassName === undefined
          ? {}
          : { maxWidthClassName: input.maxWidthClassName })}
        {...(input.placeholder === undefined ? {} : { placeholder: input.placeholder })}
      />
    );
  }

  return (
    <div className={containerClassName}>
      <div className="flex max-w-full items-center gap-1">
        <HeadingTag className={`min-w-0 ${headingClassName}${headingToneClassName}`}>
          {value}
        </HeadingTag>
        <Button
          aria-label={input.editButtonLabel}
          disabled={input.disabled === true || status === "saving"}
          onClick={() => {
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
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <PencilSimpleIcon aria-hidden className="size-4" />
        </Button>
      </div>
      {errorState === null ? null : <Notice variant="alert">{errorState.message}</Notice>}
    </div>
  );
}
