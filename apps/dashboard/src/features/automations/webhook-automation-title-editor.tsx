import { useState } from "react";

import { EditableHeading } from "../shared/editable-heading.js";
import { PageTitleField } from "../shared/page-title-field.js";

export function WebhookAutomationTitleEditor(input: {
  mode: "create" | "edit";
  title: string;
  saveDisabled: boolean;
  onCommit: (nextValue: string) => void;
  errorMessage: string | undefined;
}): React.JSX.Element {
  if (input.mode === "create") {
    return (
      <PageTitleField
        ariaLabel="Automation name"
        autoFocus={true}
        className="text-base font-medium"
        fieldId="automation-name"
        label="Automation name"
        maxWidthClassName="max-w-4xl"
        onChange={input.onCommit}
        placeholder="Automation name"
        showLabel={true}
        value={input.title}
        {...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage })}
      />
    );
  }

  return (
    <WebhookAutomationEditableTitle
      key={input.title}
      errorMessage={input.errorMessage}
      onCommit={input.onCommit}
      saveDisabled={input.saveDisabled}
      title={input.title}
    />
  );
}

function WebhookAutomationEditableTitle(input: {
  title: string;
  saveDisabled: boolean;
  onCommit: (nextValue: string) => void;
  errorMessage: string | undefined;
}): React.JSX.Element {
  const [draftValue, setDraftValue] = useState(input.title);
  const [isEditing, setIsEditing] = useState(false);

  function commitDraft(): void {
    setIsEditing(false);
    input.onCommit(draftValue);
  }

  function cancelEdit(): void {
    setDraftValue(input.title);
    setIsEditing(false);
  }

  return (
    <EditableHeading
      ariaLabel="Automation name"
      cancelOnEscape={true}
      draftValue={draftValue}
      editButtonLabel="Edit automation name"
      errorMessage={input.errorMessage}
      inputClassName="text-base font-medium"
      isEditing={isEditing}
      maxWidthClassName="max-w-4xl"
      onCancel={cancelEdit}
      onCommit={commitDraft}
      onDraftValueChange={setDraftValue}
      onEditStart={() => {
        setIsEditing(true);
      }}
      placeholder="Automation name"
      saveDisabled={input.saveDisabled}
      value={input.title}
    />
  );
}
