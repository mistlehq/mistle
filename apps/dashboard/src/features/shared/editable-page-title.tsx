import { Button } from "@mistle/ui";
import { PencilSimpleIcon } from "@phosphor-icons/react";

import { PageTitleField } from "./page-title-field.js";

export function EditablePageTitle(input: {
  title: string;
  draftValue: string;
  isEditing: boolean;
  ariaLabel: string;
  editButtonLabel: string;
  placeholder: string | undefined;
  errorMessage: string | undefined;
  saveDisabled: boolean;
  cancelOnEscape: boolean | undefined;
  maxWidthClassName: string | undefined;
  onEditStart: () => void;
  onDraftValueChange: (nextValue: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const containerClassName = `w-full ${input.maxWidthClassName ?? "max-w-2xl"} space-y-2`;

  if (input.isEditing) {
    return (
      <PageTitleField
        ariaLabel={input.ariaLabel}
        autoFocus={true}
        fieldId="editable-page-title-input"
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
      <div className="inline-flex h-10 items-center gap-1">
        <h1 className="text-xl font-semibold leading-none">{input.title}</h1>
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
