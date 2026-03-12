import { useEffect, useState } from "react";

import { EditablePageTitle } from "../shared/editable-page-title.js";
import { PageTitleField } from "../shared/page-title-field.js";

export function WebhookAutomationTitleEditor(input: {
  mode: "create" | "edit";
  title: string;
  saveDisabled: boolean;
  onCommit: (nextValue: string) => void;
  errorMessage: string | undefined;
}): React.JSX.Element {
  const [draftValue, setDraftValue] = useState(input.title);
  const [isEditing, setIsEditing] = useState(input.mode === "create");

  useEffect(() => {
    setDraftValue(input.title);
  }, [input.title]);

  function commitDraft(): void {
    setIsEditing(input.mode === "create");
    input.onCommit(draftValue);
  }

  function cancelEdit(): void {
    setDraftValue(input.title);
    setIsEditing(input.mode === "create");
  }

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
    <EditablePageTitle
      ariaLabel="Automation name"
      cancelOnEscape={true}
      draftValue={draftValue}
      editButtonLabel="Edit automation name"
      errorMessage={input.errorMessage}
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
      title={input.title}
    />
  );
}
