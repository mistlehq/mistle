import { AutoSaveEditableHeading } from "../shared/auto-save-editable-heading.js";

export function WebhookAutomationTitleEditor(input: {
  title: string;
  saveDisabled: boolean;
  onCommit: (nextValue: string) => Promise<void> | void;
  errorMessage: string | undefined;
}): React.JSX.Element {
  return (
    <AutoSaveEditableHeading
      ariaLabel="Automation name"
      editButtonLabel="Edit automation name"
      key={input.title}
      initialValue={input.title}
      inputClassName="text-base font-medium"
      maxWidthClassName="max-w-4xl"
      onSave={async (nextValue) => {
        if (input.saveDisabled) {
          return;
        }

        await input.onCommit(nextValue.trim());
      }}
      placeholder="Automation name"
      validate={(nextValue) => {
        return nextValue.trim().length === 0 ? "Automation name is required." : null;
      }}
      {...(input.errorMessage === undefined
        ? {}
        : {
            initialErrorState: {
              kind: "save" as const,
              message: input.errorMessage,
            },
          })}
    />
  );
}
