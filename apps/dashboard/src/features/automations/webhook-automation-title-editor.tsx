import { useState } from "react";

import { InlineEditableHeadingField } from "../shared/inline-editable-heading-field.js";

export function WebhookAutomationTitleEditor(input: {
  title: string;
  disabled: boolean;
  onCommit: (nextValue: string) => void;
  errorMessage: string | undefined;
}): React.JSX.Element {
  return (
    <WebhookAutomationEditableTitle
      key={input.title}
      disabled={input.disabled}
      errorMessage={input.errorMessage}
      onCommit={input.onCommit}
      title={input.title}
    />
  );
}

function WebhookAutomationEditableTitle(input: {
  title: string;
  disabled: boolean;
  onCommit: (nextValue: string) => void;
  errorMessage: string | undefined;
}): React.JSX.Element {
  const [draftValue, setDraftValue] = useState(input.title);

  function commitDraft(): void {
    input.onCommit(draftValue);
  }

  function cancelEdit(): void {
    setDraftValue(input.title);
  }

  return (
    <InlineEditableHeadingField
      ariaLabel="Trigger name"
      cancelOnEscape={true}
      disabled={input.disabled}
      draftValue={draftValue}
      errorMessage={input.errorMessage}
      maxWidthClassName="max-w-4xl"
      onCancel={cancelEdit}
      onCommit={commitDraft}
      onDraftValueChange={setDraftValue}
      onFocus={() => {}}
      placeholder="Trigger name"
    />
  );
}
