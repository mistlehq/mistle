import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@mistle/ui";
import { CaretDownIcon } from "@phosphor-icons/react";

import { deriveInitials } from "../shared/derive-initials.js";

export function OrganizationMenuTrigger(input: {
  organizationName: string | null;
  organizationImageUrl?: string | null;
  organizationErrorMessage: string | null;
  isSigningOut: boolean;
  onNavigateToSettings: () => void;
  onSignOut: () => void;
}): React.JSX.Element {
  const organizationName = input.organizationName ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Organization menu"
            className="h-auto w-full justify-start px-2 py-2 text-left"
            type="button"
            variant="ghost"
          />
        }
      >
        <div className="flex w-full items-center gap-2">
          <Avatar className="h-8 w-8 shrink-0">
            {input.organizationImageUrl === undefined ||
            input.organizationImageUrl === null ? null : (
              <AvatarImage alt={`${organizationName} logo`} src={input.organizationImageUrl} />
            )}
            <AvatarFallback>
              {deriveInitials({ name: organizationName, fallback: "O" })}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p
              className="text-sidebar-foreground truncate text-sm font-medium"
              title={organizationName}
            >
              {organizationName}
            </p>
          </div>
          <CaretDownIcon aria-hidden className="text-sidebar-foreground/70 h-4 w-4 shrink-0" />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={8}>
        {input.organizationErrorMessage !== null ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuItem disabled>{input.organizationErrorMessage}</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={input.onNavigateToSettings}>Settings</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={input.isSigningOut}
            onClick={input.onSignOut}
            variant="destructive"
          >
            {input.isSigningOut ? "Signing out..." : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
