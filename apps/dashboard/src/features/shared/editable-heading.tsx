import { Button, Notice, cn } from "@mistle/ui";
import { PencilSimpleIcon } from "@phosphor-icons/react";

import { AutoSaveInputSurface } from "./auto-save-input-surface.js";
import type { AutoSaveInputVisualStatus } from "./auto-save-input-surface.js";
import { PageTitleField } from "./page-title-field.js";

export function EditableHeading(input: {
  value: string;
  draftValue: string;
  isEditing: boolean;
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
  editVariant?: "default" | "inline";
  onEditStart: () => void;
  onDraftValueChange: (nextValue: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const containerClassName = `w-full ${input.maxWidthClassName ?? "max-w-2xl"} space-y-2`;
  const HeadingTag = input.headingTag ?? "h1";
  const headingClassName = input.headingClassName ?? "text-xl font-semibold leading-none";
  const headingToneClassName = input.errorMessage === undefined ? "" : " text-destructive";
  const editVariant = input.editVariant ?? "default";

  if (editVariant === "inline") {
    const inlineSize = Math.max(
      input.draftValue.trim().length,
      input.placeholder?.trim().length ?? 0,
      1,
    );

    return (
      <div className={containerClassName}>
        <AutoSaveInputSurface
          ariaLabel={input.ariaLabel}
          autoFocus={input.isEditing}
          id="editable-heading-input"
          onBlur={input.onCommit}
          onChange={input.onDraftValueChange}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
              return;
            }

            if (event.key === "Escape" && (input.cancelOnEscape ?? true)) {
              input.onCancel();
            }
          }}
          saveStatus={input.saveStatus ?? "idle"}
          size={inlineSize}
          {...(input.isEditing
            ? {}
            : {
                idleTrailingAdornment: (
                  <PencilSimpleIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                ),
              })}
          value={input.draftValue}
          variant="inline"
          {...(input.disabled === undefined ? {} : { disabled: input.disabled })}
          {...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage })}
          inputClassName={cn(
            "w-auto border-0 border-b border-transparent rounded-none pl-0 py-1 text-xl font-semibold leading-none hover:border-border hover:bg-transparent focus-visible:border-border focus-visible:bg-transparent",
            input.inputClassName,
          )}
          {...(input.placeholder === undefined ? {} : { placeholder: input.placeholder })}
        />
      </div>
    );
  }

  if (input.isEditing) {
    return (
      <PageTitleField
        ariaLabel={input.ariaLabel}
        autoFocus={true}
        disabled={input.disabled}
        fieldId="editable-heading-input"
        label={input.ariaLabel}
        onBlur={input.onCommit}
        onChange={input.onDraftValueChange}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
            return;
          }

          if (event.key === "Escape" && (input.cancelOnEscape ?? true)) {
            input.onCancel();
          }
        }}
        saveStatus={input.saveStatus ?? "idle"}
        showLabel={false}
        value={input.draftValue}
        {...(input.inputClassName === undefined ? {} : { className: input.inputClassName })}
        {...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage })}
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
