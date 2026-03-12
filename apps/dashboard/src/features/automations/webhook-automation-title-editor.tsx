import { useEffect, useState } from "react";

import { EditablePageTitle } from "../shared/editable-page-title.js";

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

  return (
    <EditablePageTitle
      ariaLabel="Automation name"
      cancelOnEscape={input.mode === "edit"}
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
