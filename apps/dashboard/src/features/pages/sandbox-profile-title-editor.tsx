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
  const titleContainerClassName = "relative h-11 w-full max-w-2xl";

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
      <div className="inline-flex h-11 items-center gap-1 rounded-md border border-transparent px-3">
        <h1 className="text-xl font-semibold leading-none">{input.title}</h1>
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
