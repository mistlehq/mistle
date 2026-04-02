import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  cn,
} from "@mistle/ui";
import { ArrowClockwiseIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

type AutoSaveStatus = "idle" | "saving" | "saved" | "saved-fading";
export type AutoSaveTextFieldErrorState = {
  kind: "validation" | "save";
  message: string;
};

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
        <div className="relative">
          <Input
            aria-invalid={errorState !== null}
            className={showStatus && errorState === null ? "pr-9" : undefined}
            disabled={input.disabled}
            id={input.id}
            onBlur={() => {
              void handleCommit();
            }}
            onChange={(event) => {
              setDraftValue(event.target.value);
              if (errorState !== null) {
                setErrorState(null);
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
          {showStatus && errorState === null ? (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
              <AutoSaveInputIndicator status={status} />
            </div>
          ) : null}
        </div>
        <div aria-live="polite" className="min-h-5" role="status">
          {errorState === null ? null : <AutoSaveStatusIndicator errorState={errorState} />}
        </div>
      </FieldContent>
    </Field>
  );
}

function AutoSaveStatusIndicator(input: {
  errorState: AutoSaveTextFieldErrorState;
}): React.JSX.Element {
  if (input.errorState.kind === "save") {
    return (
      <div className="flex items-center justify-end text-xs text-destructive">
        <span>{input.errorState.message}</span>
      </div>
    );
  }

  if (input.errorState.kind === "validation") {
    return (
      <div className="flex items-center justify-end text-xs text-destructive">
        <span>{input.errorState.message}</span>
      </div>
    );
  }
}

function AutoSaveInputIndicator(input: { status: AutoSaveStatus }): React.JSX.Element | null {
  if (input.status === "saving") {
    return (
      <div className="text-muted-foreground flex items-center justify-end">
        <ArrowClockwiseIcon aria-hidden className="size-3.5 animate-spin" />
        <span className="sr-only">Saving</span>
      </div>
    );
  }

  if (input.status === "saved" || input.status === "saved-fading") {
    return (
      <div
        className={cn(
          "flex items-center justify-end text-emerald-700 transition-opacity duration-700",
          input.status === "saved" ? "opacity-100" : "opacity-0",
        )}
      >
        <CheckCircleIcon aria-hidden className="size-4" weight="fill" />
        <span className="sr-only">Saved</span>
      </div>
    );
  }

  return null;
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
