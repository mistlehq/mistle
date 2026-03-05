import { Button, Input } from "@mistle/ui";
import { PencilSimpleIcon } from "@phosphor-icons/react";

export function SandboxProfileTitleEditor(input: {
  title: string;
  isEditing: boolean;
  draftValue: string;
  saveDisabled: boolean;
  onEditStart: () => void;
  onDraftValueChange: (nextValue: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const titleContainerClassName = "relative w-full max-w-2xl";

  if (input.isEditing) {
    return (
      <div className={titleContainerClassName}>
        <Input
          aria-label="Profile name"
          autoFocus
          className="h-11 w-full text-xl font-semibold leading-none"
          onBlur={input.onCommit}
          onChange={(event) => {
            input.onDraftValueChange(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
              return;
            }
            if (event.key === "Escape") {
              input.onCancel();
            }
          }}
          value={input.draftValue}
        />
      </div>
    );
  }

  return (
    <div className={titleContainerClassName}>
      <div className="inline-flex items-center gap-1">
        <h1 className="text-xl font-semibold">{input.title}</h1>
        <Button
          aria-label="Edit profile name"
          disabled={input.saveDisabled}
          onClick={input.onEditStart}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <PencilSimpleIcon aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}
