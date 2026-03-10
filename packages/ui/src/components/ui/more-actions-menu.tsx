import { DotsThreeIcon } from "@phosphor-icons/react";

import { cn } from "../../lib/utils.js";
import { Button } from "./button.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./dropdown-menu.js";

export type MoreActionsMenuProps = {
  triggerLabel: string;
  children: React.ReactNode;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  disabled?: boolean;
  triggerSize?: "icon-xs" | "icon-sm" | "icon" | "icon-lg";
};

export function MoreActionsMenu(input: MoreActionsMenuProps): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={input.triggerLabel}
            disabled={input.disabled}
            size={input.triggerSize ?? "icon"}
            variant="ghost"
          />
        }
      >
        <DotsThreeIcon aria-hidden className="size-6 text-foreground" weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={input.align ?? "end"}
        className={cn("min-w-40", input.contentClassName)}
        sideOffset={input.sideOffset ?? 8}
      >
        {input.children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
