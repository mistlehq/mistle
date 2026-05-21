import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@mistle/ui";
import { HouseIcon, LightningIcon, PackageIcon, PuzzlePieceIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter, NavLink } from "react-router";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { ErrorNotice } from "../auth/error-notice.js";
import { AppShellView } from "../shell/app-shell-view.js";
import { AppSidebarHeader } from "../shell/app-sidebar-header.js";
import { PageFrame } from "./page-frame.js";
import { UnavailableResourceState } from "./unavailable-resource-state.js";

type UnavailableResourceStateStoryArgs = {
  shellPathname: string;
};

function UnavailableResourceInShellStory({
  shellPathname,
}: UnavailableResourceStateStoryArgs): React.JSX.Element {
  return (
    <MemoryRouter initialEntries={[shellPathname]}>
      <AppShellView
        contentInsetOwner="child"
        mainContent={
          <PageFrame width="normal">
            <UnavailableResourceState />
          </PageFrame>
        }
        renderSidebarTrigger
        sidebarContent={<StorySidebarContent locationPathname={shellPathname} />}
        sidebarDefaultOpen
        sidebarFooterContent={<ErrorNotice message={null} />}
        sidebarHeaderContent={
          <AppSidebarHeader
            activeOrganizationId="org_mistle"
            isSigningOut={false}
            onNavigateToSettings={() => {}}
            onSignOut={() => {}}
            onSwitchOrganization={() => {}}
            organizationImageUrl={null}
            organizationName="Mistle Labs"
            organizationSummaryErrorMessage={null}
            organizationSwitcherErrorMessage={null}
            organizations={[{ id: "org_mistle", name: "Mistle Labs" }]}
          />
        }
        topLoadingBar={<div className="h-0" />}
        viewportMode="document"
      />
    </MemoryRouter>
  );
}

function StorySidebarContent({
  locationPathname,
}: {
  locationPathname: string;
}): React.JSX.Element {
  return (
    <SidebarGroup className="pt-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={locationPathname === "/"} render={<NavLink to="/" />}>
              <HouseIcon aria-hidden className="size-5 shrink-0 md:size-4" />
              <span>Home</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={
                locationPathname === "/integrations" ||
                locationPathname.startsWith("/integrations/")
              }
              render={<NavLink to="/integrations" />}
            >
              <PuzzlePieceIcon aria-hidden className="size-5 shrink-0 md:size-4" />
              <span>Integrations</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={
                locationPathname === "/sandbox-profiles" ||
                locationPathname.startsWith("/sandbox-profiles/")
              }
              render={<NavLink to="/sandbox-profiles" />}
            >
              <PackageIcon aria-hidden className="size-5 shrink-0 md:size-4" />
              <span>Sandbox Profiles</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={
                locationPathname === "/triggers" || locationPathname.startsWith("/triggers/")
              }
              render={<NavLink to="/triggers" />}
            >
              <LightningIcon aria-hidden className="size-5 shrink-0 md:size-4" />
              <span>Triggers</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const meta = {
  title: "Dashboard/Shared/UnavailableResourceState",
  component: UnavailableResourceInShellStory,
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    shellPathname: "/sandbox-profiles/sbp_missing",
  },
  render: function RenderStory(args): React.JSX.Element {
    return <UnavailableResourceInShellStory {...args} />;
  },
} satisfies Meta<UnavailableResourceStateStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const InAppShell: Story = {
  name: "In App Shell",
};
