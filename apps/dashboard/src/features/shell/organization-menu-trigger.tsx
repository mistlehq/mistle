import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@mistle/ui";
import { CaretDownIcon } from "@phosphor-icons/react";

import { deriveInitials } from "../shared/derive-initials.js";

export type OrganizationMenuOrganizationOption = {
  id: string;
  name: string;
};

export function OrganizationMenuTrigger(input: {
  organizationName: string | null;
  organizationImageUrl?: string | null;
  organizationErrorMessage: string | null;
  organizations?: OrganizationMenuOrganizationOption[];
  activeOrganizationId?: string | null;
  isSwitchingOrganization?: boolean;
  isSigningOut: boolean;
  onNavigateToSettings: () => void;
  onSwitchOrganization?: (organizationId: string) => void;
  onSignOut: () => void;
}): React.JSX.Element {
  const organizationName = input.organizationName ?? "";
  const organizations = input.organizations ?? [];
  const showOrganizationSwitcher =
    organizations.length > 0 && typeof input.onSwitchOrganization === "function";

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
      <DropdownMenuContent align="start" className="w-64" side="bottom" sideOffset={8}>
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={input.onNavigateToSettings}>Settings</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {showOrganizationSwitcher ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={input.isSwitchingOrganization}>
                Switch organization
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {input.organizationErrorMessage !== null ? (
                  <DropdownMenuItem disabled>{input.organizationErrorMessage}</DropdownMenuItem>
                ) : (
                  <DropdownMenuRadioGroup value={input.activeOrganizationId ?? undefined}>
                    {organizations.map((organization) => (
                      <DropdownMenuRadioItem
                        disabled={input.isSwitchingOrganization}
                        key={organization.id}
                        onClick={() => {
                          input.onSwitchOrganization?.(organization.id);
                        }}
                        value={organization.id}
                      >
                        {organization.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
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
