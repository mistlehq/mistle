import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldHeader,
  FieldLabel,
  Input,
  cn,
} from "@mistle/ui";
import { ArrowClockwiseIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

type AutoSaveStatus = "idle" | "saving" | "saved" | "saved-fading";

export type AutoSaveTextFieldProps = {
  id: string;
  label: string;
  initialValue: string;
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const saveSequenceRef = useRef(0);
  const fadeStartTimeoutRef = useRef<TimerHandle | null>(null);
  const fadeEndTimeoutRef = useRef<TimerHandle | null>(null);

  useEffect(() => {
    setDraftValue(input.initialValue);
    setCommittedValue(input.initialValue);
    setErrorMessage(null);
    setStatus("idle");
  }, [input.initialValue]);

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
      setErrorMessage(validationMessage);
      setStatus("idle");
      return;
    }

    const currentSaveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = currentSaveSequence;
    setErrorMessage(null);
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
      setErrorMessage(getErrorMessage(error));
    }
  }

  const showStatus = status !== "idle";

  return (
    <Field contentWidth="fill" orientation="horizontal">
      <FieldHeader>
        <FieldLabel htmlFor={input.id}>{input.label}</FieldLabel>
        {input.description === undefined ? null : (
          <FieldDescription>{input.description}</FieldDescription>
        )}
      </FieldHeader>
      <FieldContent>
        <Input
          aria-invalid={errorMessage !== null}
          disabled={input.disabled}
          id={input.id}
          onBlur={() => {
            void handleCommit();
          }}
          onChange={(event) => {
            setDraftValue(event.target.value);
            if (errorMessage !== null) {
              setErrorMessage(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          placeholder={input.placeholder}
          value={draftValue}
        />
        <div aria-live="polite" className="min-h-5" role="status">
          {showStatus ? <AutoSaveStatusIndicator status={status} /> : null}
        </div>
        {errorMessage === null ? null : <FieldError errors={[{ message: errorMessage }]} />}
      </FieldContent>
    </Field>
  );
}

function AutoSaveStatusIndicator(input: { status: AutoSaveStatus }): React.JSX.Element {
  if (input.status === "saving") {
    return (
      <div className="text-muted-foreground flex items-center justify-end">
        <ArrowClockwiseIcon aria-hidden className="size-3.5 animate-spin" />
        <span className="sr-only">Saving</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-end text-emerald-700 transition-opacity duration-700",
        input.status === "saved" ? "opacity-100" : "opacity-0",
      )}
    >
      <CheckCircleIcon aria-hidden className="size-3.5" weight="fill" />
      <span className="sr-only">Saved</span>
    </div>
  );
}

function scheduleSavedStateReset(input: {
  successVisibleDurationMs: number;
  successFadeDurationMs: number;
  fadeStartTimeoutRef: { current: TimerHandle | null };
  fadeEndTimeoutRef: { current: TimerHandle | null };
  onFadeStart: () => void;
  onFadeEnd: () => void;
  scheduler: Scheduler;
}): void {
  const fadeStartDelayMs = Math.max(
    0,
    input.successVisibleDurationMs - input.successFadeDurationMs,
  );

  input.fadeStartTimeoutRef.current = input.scheduler.schedule(() => {
    input.onFadeStart();
  }, fadeStartDelayMs);

  input.fadeEndTimeoutRef.current = input.scheduler.schedule(() => {
    input.onFadeEnd();
  }, input.successVisibleDurationMs);
}

function clearPendingStatusTimeouts(input: {
  fadeStartTimeoutRef: { current: TimerHandle | null };
  fadeEndTimeoutRef: { current: TimerHandle | null };
  scheduler: Scheduler;
}): void {
  if (input.fadeStartTimeoutRef.current !== null) {
    input.scheduler.cancel(input.fadeStartTimeoutRef.current);
    input.fadeStartTimeoutRef.current = null;
  }

  if (input.fadeEndTimeoutRef.current !== null) {
    input.scheduler.cancel(input.fadeEndTimeoutRef.current);
    input.fadeEndTimeoutRef.current = null;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Could not save changes.";
}
