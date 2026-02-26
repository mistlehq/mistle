import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@mistle/ui";
import { CaretDownIcon } from "@phosphor-icons/react";

function deriveInitials(input: { name: string; fallback: string }): string {
  const words = input.name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return input.fallback;
  }

  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return initials.length > 0 ? initials : input.fallback;
}

export function OrganizationMenuTrigger(input: {
  organizationName: string;
  organizationErrorMessage: string | null;
  isSigningOut: boolean;
  onNavigateToSettings: () => void;
  onSignOut: () => void;
}): React.JSX.Element {
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
            <AvatarFallback>
              {deriveInitials({ name: input.organizationName, fallback: "O" })}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p
              className="text-sidebar-foreground truncate text-sm font-medium"
              title={input.organizationName}
            >
              {input.organizationName}
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
