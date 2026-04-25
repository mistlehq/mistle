import { CaretDownIcon, DotsThreeIcon } from "@phosphor-icons/react";

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
  triggerIconVariant?: "dots" | "chevron-down";
  triggerSize?: "icon-xs" | "icon-sm" | "icon" | "icon-lg";
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
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
            variant={input.triggerVariant ?? "ghost"}
          />
        }
      >
        <MoreActionsMenuTriggerIcon variant={input.triggerIconVariant ?? "dots"} />
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

function MoreActionsMenuTriggerIcon(input: {
  variant: NonNullable<MoreActionsMenuProps["triggerIconVariant"]>;
}): React.JSX.Element {
  if (input.variant === "chevron-down") {
    return <CaretDownIcon aria-hidden className="size-4" />;
  }

  return <DotsThreeIcon aria-hidden className="size-6" weight="bold" />;
}
