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
  organizationSummaryErrorMessage: string | null;
  organizationSwitcherErrorMessage: string | null;
  organizations?: OrganizationMenuOrganizationOption[];
  activeOrganizationId?: string | null;
  isSwitchingOrganization?: boolean;
  isSigningOut: boolean;
  isMenuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  isSwitchOrganizationSubmenuOpen?: boolean;
  onSwitchOrganizationSubmenuOpenChange?: (open: boolean) => void;
  onNavigateToSettings: () => void;
  onSwitchOrganization?: (organizationId: string) => void;
  onSignOut: () => void;
}): React.JSX.Element {
  const organizationName = input.organizationName ?? "";
  const organizations = input.organizations ?? [];
  const showOrganizationSwitcherError = input.organizationSwitcherErrorMessage !== null;
  const showOrganizationSwitcher =
    (organizations.length > 0 || showOrganizationSwitcherError) &&
    typeof input.onSwitchOrganization === "function";

  return (
    <DropdownMenu onOpenChange={input.onMenuOpenChange} open={input.isMenuOpen}>
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
        {input.organizationSummaryErrorMessage !== null ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuItem disabled>{input.organizationSummaryErrorMessage}</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={input.onNavigateToSettings}>Settings</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {showOrganizationSwitcher ? (
            <DropdownMenuSub
              onOpenChange={input.onSwitchOrganizationSubmenuOpenChange}
              open={input.isSwitchOrganizationSubmenuOpen}
            >
              <DropdownMenuSubTrigger disabled={input.isSwitchingOrganization}>
                Switch organization
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {organizations.length > 0 ? (
                  <DropdownMenuRadioGroup
                    onValueChange={(organizationId) => {
                      input.onSwitchOrganization?.(organizationId);
                    }}
                    value={input.activeOrganizationId ?? undefined}
                  >
                    {organizations.map((organization) => (
                      <DropdownMenuRadioItem
                        disabled={input.isSwitchingOrganization}
                        key={organization.id}
                        value={organization.id}
                      >
                        {organization.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                ) : null}
                {showOrganizationSwitcherError ? (
                  <>
                    {organizations.length > 0 ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem disabled>
                      {input.organizationSwitcherErrorMessage}
                    </DropdownMenuItem>
                  </>
                ) : null}
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
