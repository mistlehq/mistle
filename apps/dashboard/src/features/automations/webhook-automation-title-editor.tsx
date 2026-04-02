import { AutoSaveEditableHeading } from "../shared/auto-save-editable-heading.js";

export function WebhookAutomationTitleEditor(input: {
  title: string;
  saveDisabled: boolean;
  onCommit: (nextValue: string) => Promise<void> | void;
  saveError: string | undefined;
}): React.JSX.Element {
  return (
    <AutoSaveEditableHeading
      ariaLabel="Automation name"
      disabled={input.saveDisabled}
      editButtonLabel="Edit automation name"
      key={input.title}
      savedValue={input.title}
      inputClassName="text-base font-medium"
      maxWidthClassName="max-w-4xl"
      onSave={async (nextValue) => {
        await input.onCommit(nextValue.trim());
      }}
      placeholder="Automation name"
      validate={(nextValue) => {
        return nextValue.trim().length === 0 ? "Automation name is required." : null;
      }}
      {...(input.saveError === undefined ? {} : { saveError: input.saveError })}
    />
  );
}
