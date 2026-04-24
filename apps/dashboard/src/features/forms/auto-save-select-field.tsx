import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  cn,
} from "@mistle/ui";
import { CaretDownIcon, CheckCircleIcon } from "@phosphor-icons/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

import {
  clearPendingStatusTimeouts,
  getErrorMessage,
  scheduleSavedStateReset,
  type AutoSaveErrorState,
} from "../shared/auto-save-behavior.js";
import type { AutoSaveInputVisualStatus } from "../shared/auto-save-input-surface.js";

export type AutoSaveSelectFieldOption = {
  label: string;
  value: string;
};

export type AutoSaveSelectFieldProps = {
  id: string;
  label: string;
  value: string;
  options: readonly AutoSaveSelectFieldOption[];
  description?: string;
  placeholder?: string;
  disabled?: boolean;
  noneLabel?: string;
  showErrorMessage?: boolean;
  triggerClassName?: string;
  onSave: (nextValue: string) => Promise<void>;
  scheduler?: Scheduler;
  successVisibleDurationMs?: number;
  successFadeDurationMs?: number;
};

type AutoSaveStatus = AutoSaveInputVisualStatus;

export function AutoSaveSelectField(input: AutoSaveSelectFieldProps): React.JSX.Element {
  const successVisibleDurationMs = input.successVisibleDurationMs ?? 2200;
  const successFadeDurationMs = input.successFadeDurationMs ?? 700;
  const scheduler = input.scheduler ?? systemScheduler;
  const showErrorMessage = input.showErrorMessage ?? true;
  const [selectedValue, setSelectedValue] = useState(input.value);
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

    const preserveStatus =
      (status === "saving" || status === "saved" || status === "saved-fading") &&
      input.value === selectedValue;

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

    setSelectedValue(input.value);
  }, [input.value, scheduler, selectedValue, status]);

  useEffect(() => {
    return () => {
      clearPendingStatusTimeouts({
        fadeEndTimeoutRef,
        fadeStartTimeoutRef,
        scheduler,
      });
    };
  }, [scheduler]);

  async function handleValueChange(nextValue: string | null): Promise<void> {
    if (
      nextValue === null ||
      input.disabled === true ||
      status === "saving" ||
      nextValue === selectedValue
    ) {
      return;
    }

    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler,
    });

    const persistedValue = input.value;
    const currentSaveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = currentSaveSequence;
    setErrorState(null);
    setSelectedValue(nextValue);
    setStatus("saving");

    try {
      await input.onSave(nextValue);

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

      setSelectedValue(persistedValue);
      setStatus("idle");
      setErrorState({
        kind: "save",
        message: getErrorMessage(error),
      });
    }
  }

  const selectedOptionLabel =
    input.options.find((option) => option.value === selectedValue)?.label ?? null;
  const showIndicator = status !== "idle" && errorState === null;
  const saveState = errorState === null ? status : "error";
  const errorMessage = showErrorMessage ? errorState?.message : undefined;
  const liveMessage =
    errorState !== null
      ? ""
      : status === "saving"
        ? "Saving"
        : status === "saved" || status === "saved-fading"
          ? "Saved"
          : "";

  return (
    <Field contentWidth="fill" orientation="horizontal">
      <FieldHeader>
        <FieldLabel htmlFor={input.id}>{input.label}</FieldLabel>
        {input.description === undefined ? null : (
          <FieldDescription>{input.description}</FieldDescription>
        )}
      </FieldHeader>
      <FieldContent>
        <div className="space-y-2" data-save-state={saveState}>
          <p aria-live="polite" className="sr-only" role="status">
            {liveMessage}
          </p>
          {input.options.length === 0 ? (
            <div
              className="text-muted-foreground ml-auto flex h-9 w-full max-w-[32rem] items-center justify-end text-right text-sm"
              id={input.id}
            >
              {input.noneLabel ?? "None"}
            </div>
          ) : (
            <Select
              items={input.options}
              onValueChange={(nextValue) => {
                void handleValueChange(nextValue);
              }}
              value={selectedValue}
            >
              <SelectTrigger
                aria-label={input.label}
                className={cn("w-full", input.triggerClassName)}
                disabled={input.disabled === true || status === "saving"}
                id={input.id}
                indicator={
                  <AutoSaveSelectIndicator showIndicator={showIndicator} status={status} />
                }
                style={{ width: "100%", maxWidth: "32rem" }}
              >
                <SelectValue
                  placeholder={input.placeholder ?? `Select ${input.label.toLowerCase()}`}
                >
                  {selectedOptionLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {input.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {errorMessage === undefined ? null : (
            <div aria-live="polite" role="status">
              <div className="flex items-center justify-start text-xs text-destructive">
                <span>{errorMessage}</span>
              </div>
            </div>
          )}
        </div>
      </FieldContent>
    </Field>
  );
}

function AutoSaveSelectIndicator(input: {
  showIndicator: boolean;
  status: AutoSaveStatus;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      {input.showIndicator ? <AutoSaveSelectStateIcon status={input.status} /> : null}
      <CaretDownIcon className="text-muted-foreground size-4 pointer-events-none" />
    </div>
  );
}

function AutoSaveSelectStateIcon(input: { status: AutoSaveStatus }): React.JSX.Element | null {
  if (input.status === "saving") {
    return (
      <div className="text-muted-foreground flex items-center justify-end">
        <Spinner className="size-3.5" />
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
