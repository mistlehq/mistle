import { Button } from "@mistle/ui";
import { PencilSimpleIcon } from "@phosphor-icons/react";

import { PageTitleField } from "./page-title-field.js";

export function EditableHeading(input: {
  value: string;
  draftValue: string;
  isEditing: boolean;
  ariaLabel: string;
  editButtonLabel: string;
  placeholder: string | undefined;
  errorMessage: string | undefined;
  saveDisabled: boolean;
  cancelOnEscape: boolean | undefined;
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

  if (input.isEditing) {
    return (
      <PageTitleField
        ariaLabel={input.ariaLabel}
        autoFocus={true}
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
        <HeadingTag className={`min-w-0 ${headingClassName}`}>{input.value}</HeadingTag>
        <Button
          aria-label={input.editButtonLabel}
          disabled={input.saveDisabled}
          onClick={input.onEditStart}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <PencilSimpleIcon aria-hidden className="size-4" />
        </Button>
      </div>
      {input.errorMessage === undefined ? null : (
        <p className="text-destructive text-sm">{input.errorMessage}</p>
      )}
    </div>
  );
}
