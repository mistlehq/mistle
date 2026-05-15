import { Input, Spinner, cn } from "@mistle/ui";
import { CheckCircleIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { useRef } from "react";

import type { AutoSaveInputVisualStatus } from "./auto-save-input-surface.js";

export type InlineEditableHeadingFieldProps = {
  ariaLabel: string;
  draftValue: string;
  placeholder?: string | undefined;
  errorMessage?: string | undefined;
  disabled: boolean;
  saveStatus?: AutoSaveInputVisualStatus | undefined;
  cancelOnEscape?: boolean | undefined;
  maxWidthClassName?: string | undefined;
  inputClassName?: string | undefined;
  size?: "sm" | "lg";
  autoFocus?: boolean | undefined;
  onFocus?: (() => void) | undefined;
  onDraftValueChange: (nextValue: string) => void;
  onCommit: () => void;
  onCancel: () => void;
};

export function InlineEditableHeadingField(
  input: InlineEditableHeadingFieldProps,
): React.JSX.Element {
  const containerClassName = `w-full ${input.maxWidthClassName ?? "max-w-2xl"} space-y-2`;
  const saveStatus = input.saveStatus ?? "idle";
  const saveState = input.errorMessage === undefined ? saveStatus : "error";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const size = input.size ?? "lg";
  const headingFieldClassName =
    size === "sm"
      ? "field-sizing-content h-8 max-w-full min-w-0 w-fit border-x-0 border-t-0 rounded-none border-b-transparent px-0 py-0 text-base font-medium leading-tight shadow-none hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 md:h-7 md:text-sm aria-invalid:border-b-destructive aria-invalid:ring-0 placeholder:!text-muted-foreground/70"
      : "field-sizing-content h-10 max-w-full min-w-0 w-fit border-x-0 border-t-0 rounded-none border-b-transparent px-0 py-0 text-xl font-semibold leading-none shadow-none hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 aria-invalid:border-b-destructive aria-invalid:ring-0 placeholder:!text-muted-foreground/70";

  function focusInput(): void {
    inputRef.current?.focus();
  }

  return (
    <div className={containerClassName} data-save-state={saveState}>
      <div className="group/editable-heading relative max-w-full w-fit [&:has(.heading-affordance:hover)_[data-slot=input]]:border-b-border [&:has(.heading-affordance:hover)_[data-slot=input]]:text-muted-foreground">
        <Input
          aria-invalid={input.errorMessage === undefined ? undefined : true}
          aria-label={input.ariaLabel}
          autoFocus={input.autoFocus}
          className={cn(
            headingFieldClassName,
            "hover:border-b-border focus-visible:border-b-border",
            input.inputClassName,
          )}
          disabled={input.disabled}
          ref={inputRef}
          onBlur={input.onCommit}
          onChange={(event) => {
            input.onDraftValueChange(event.currentTarget.value);
          }}
          onFocus={input.onFocus}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
              return;
            }

            if (event.key === "Escape" && (input.cancelOnEscape ?? true)) {
              input.onCancel();
            }
          }}
          placeholder={input.placeholder}
          value={input.draftValue}
          variant="inline"
        />
        <div className="absolute top-1/2 left-full flex -translate-y-1/2 items-center gap-1.5 pl-2 text-muted-foreground">
          {input.errorMessage === undefined && saveStatus === "idle" ? (
            <div
              aria-hidden
              className="heading-affordance flex cursor-text items-center"
              onClick={focusInput}
              onMouseDown={(event) => {
                event.preventDefault();
                focusInput();
              }}
            >
              <PencilSimpleIcon
                aria-hidden
                className="size-4 shrink-0 transition-opacity group-hover/editable-heading:opacity-0 group-focus-within/editable-heading:opacity-0"
              />
            </div>
          ) : null}
          <InlineEditableHeadingStatus errorMessage={input.errorMessage} status={saveStatus} />
        </div>
      </div>
      {input.errorMessage === undefined ? null : (
        <div aria-live="polite" role="status">
          <div className="flex items-center justify-start text-xs text-destructive">
            <span>{input.errorMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function InlineEditableHeadingStatus(input: {
  errorMessage: string | undefined;
  status: AutoSaveInputVisualStatus;
}): React.JSX.Element | null {
  if (input.errorMessage !== undefined || input.status === "idle") {
    return null;
  }

  if (input.status === "saving") {
    return <Spinner className="size-3.5 shrink-0" />;
  }

  return (
    <CheckCircleIcon
      aria-hidden
      className={cn(
        "size-4 shrink-0 text-emerald-600 transition-opacity duration-700 dark:text-emerald-400",
        input.status === "saved" ? "opacity-100" : "opacity-0",
      )}
      weight="fill"
    />
  );
}
