import { FieldError, Input } from "@mistle/ui";

import { InviteChipBadge } from "./invite-chip-badge.js";
import type { InviteChip } from "./member-invite-state.js";
import { parseInviteTokens } from "./member-invite-state.js";

const EMAIL_INPUT_PLACEHOLDER =
  "Type emails and press enter, comma, space, or paste multiple values";
const COMMIT_KEYS = new Set(["Enter", "Tab", ",", " "]);

export function MemberInviteChipInput(input: {
  chips: InviteChip[];
  value: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  onAddTokens: (tokens: string[]) => void;
  onRemoveChip: (chipId: string) => void;
}): React.JSX.Element {
  function commitText(value: string): void {
    const tokens = parseInviteTokens(value);
    if (tokens.length === 0) {
      input.onValueChange("");
      return;
    }
    input.onAddTokens(tokens);
    input.onValueChange("");
  }

  return (
    <div className="gap-2 flex min-w-0 flex-col">
      {input.chips.length > 0 ? (
        <div className="flex max-h-48 min-w-0 flex-wrap gap-2 overflow-x-hidden overflow-y-auto pr-1">
          {input.chips.map((chip) => (
            <InviteChipBadge
              chip={chip}
              disabled={input.disabled === true}
              key={chip.id}
              onRemove={input.onRemoveChip}
            />
          ))}
        </div>
      ) : null}
      <Input
        disabled={input.disabled}
        onBlur={() => commitText(input.value)}
        onChange={(event) => input.onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (COMMIT_KEYS.has(event.key)) {
            event.preventDefault();
            commitText(input.value);
          }
        }}
        onPaste={(event) => {
          const pastedText = event.clipboardData.getData("text");
          const tokens = parseInviteTokens(pastedText);
          if (tokens.length === 0) {
            return;
          }
          event.preventDefault();
          input.onAddTokens(tokens);
          input.onValueChange("");
        }}
        placeholder={EMAIL_INPUT_PLACEHOLDER}
        value={input.value}
      />
      {input.chips.some((chip) => chip.status === "invalid_email") ? (
        <FieldError errors={[{ message: "Some emails are invalid and will not be sent." }]} />
      ) : null}
    </div>
  );
}
