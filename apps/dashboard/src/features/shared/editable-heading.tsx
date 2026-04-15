import { Button, Input, Notice, Spinner, cn } from "@mistle/ui";
import { CheckCircleIcon, PencilSimpleIcon } from "@phosphor-icons/react";

import type { AutoSaveInputVisualStatus } from "./auto-save-input-surface.js";

export function EditableHeading(input: {
  value: string;
  draftValue: string;
  isEditing: boolean;
  alwaysEditing?: boolean;
  ariaLabel: string;
  editButtonLabel: string;
  placeholder: string | undefined;
  errorMessage: string | undefined;
  disabled: boolean;
  saveStatus?: AutoSaveInputVisualStatus;
  cancelOnEscape?: boolean;
  maxWidthClassName: string | undefined;
  headingTag?: "div" | "h1" | "h2";
  headingClassName?: string;
  inputClassName?: string;
  onEditStart: () => void;
  onDraftValueChange: (nextValue: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const containerClassName = `w-full ${input.maxWidthClassName ?? "max-w-2xl"} space-y-2`;
  const HeadingTag = input.headingTag ?? "h1";
  const headingClassName = input.headingClassName ?? "text-xl font-semibold leading-none";
  const headingToneClassName = input.errorMessage === undefined ? "" : " text-destructive";

  if (input.alwaysEditing === true) {
    return <InlineEditableHeadingField {...input} />;
  }

  if (input.isEditing) {
    return <InlineEditableHeadingField autoFocus={true} {...input} />;
  }

  return (
    <div className={containerClassName}>
      <div className="flex max-w-full items-center gap-1">
        <HeadingTag className={`min-w-0 ${headingClassName}${headingToneClassName}`}>
          {input.value}
        </HeadingTag>
        <Button
          aria-label={input.editButtonLabel}
          disabled={input.disabled}
          onClick={input.onEditStart}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <PencilSimpleIcon aria-hidden className="size-4" />
        </Button>
      </div>
      {input.errorMessage === undefined ? null : (
        <Notice variant="alert">{input.errorMessage}</Notice>
      )}
    </div>
  );
}

function InlineEditableHeadingField(
  input: Parameters<typeof EditableHeading>[0] & {
    autoFocus?: boolean;
  },
): React.JSX.Element {
  const containerClassName = `w-full ${input.maxWidthClassName ?? "max-w-2xl"} space-y-2`;
  const saveStatus = input.saveStatus ?? "idle";
  const saveState = input.errorMessage === undefined ? saveStatus : "error";

  return (
    <div className={containerClassName} data-save-state={saveState}>
      <div className="group/editable-heading relative max-w-full w-fit">
        <Input
          aria-invalid={input.errorMessage === undefined ? undefined : true}
          aria-label={input.ariaLabel}
          autoFocus={input.autoFocus}
          className={cn(
            "field-sizing-content h-10 max-w-full min-w-0 w-fit border-x-0 border-t-0 rounded-none border-b-transparent px-0 py-0 text-xl font-semibold leading-none shadow-none hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 aria-invalid:border-b-destructive aria-invalid:ring-0 placeholder:!text-muted-foreground/70",
            "hover:border-b-border focus-visible:border-b-border",
            input.inputClassName,
          )}
          disabled={input.disabled}
          onBlur={() => {
            input.onCommit();
          }}
          onChange={(event) => {
            input.onDraftValueChange(event.currentTarget.value);
          }}
          onFocus={() => {
            input.onEditStart();
          }}
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
        <div className="pointer-events-none absolute top-1/2 left-full flex -translate-y-1/2 items-center gap-1.5 pl-2 text-muted-foreground">
          {input.errorMessage === undefined && saveStatus === "idle" ? (
            <PencilSimpleIcon
              aria-hidden
              className="size-4 shrink-0 transition-opacity group-hover/editable-heading:opacity-0 group-focus-within/editable-heading:opacity-0"
            />
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
        "size-4 shrink-0 text-emerald-700 transition-opacity duration-700",
        input.status === "saved" ? "opacity-100" : "opacity-0",
      )}
      weight="fill"
    />
  );
}
