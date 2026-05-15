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
            className="h-auto w-full justify-start px-3 py-3 text-left md:px-2 md:py-2"
            type="button"
            variant="ghost"
          />
        }
      >
        <div className="flex w-full items-center gap-3 md:gap-2">
          <Avatar className="h-10 w-10 shrink-0 md:h-8 md:w-8">
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
              className="text-sidebar-foreground truncate text-base font-medium md:text-sm"
              title={organizationName}
            >
              {organizationName}
            </p>
          </div>
          <CaretDownIcon
            aria-hidden
            className="text-sidebar-foreground/70 h-5 w-5 shrink-0 md:h-4 md:w-4"
          />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[min(calc(100vw-2rem),20rem)] md:w-64"
        side="bottom"
        sideOffset={8}
      >
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
              <DropdownMenuSubContent className="min-w-48">
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
