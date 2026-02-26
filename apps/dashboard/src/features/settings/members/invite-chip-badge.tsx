import { Badge, Button } from "@mistle/ui";
import { XIcon } from "@phosphor-icons/react";

import type { InviteChip } from "./member-invite-state.js";

function chipVariant(status: InviteChip["status"]): "outline" | "secondary" | "destructive" {
  if (status === "invited" || status === "already_invited" || status === "already_member") {
    return "secondary";
  }

  if (status === "invalid_email" || status === "error") {
    return "destructive";
  }

  return "outline";
}

export function InviteChipBadge(input: {
  chip: InviteChip;
  disabled?: boolean;
  onRemove: (chipId: string) => void;
}): React.JSX.Element {
  return (
    <Badge
      className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden"
      variant={chipVariant(input.chip.status)}
    >
      <span className="min-w-0 truncate" title={input.chip.normalizedEmail}>
        {input.chip.normalizedEmail}
      </span>
      <Button
        aria-label={`Remove ${input.chip.normalizedEmail}`}
        className="shrink-0 text-current/70 hover:text-current"
        disabled={input.disabled}
        onClick={() => input.onRemove(input.chip.id)}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <XIcon aria-hidden="true" />
      </Button>
    </Badge>
  );
}
