import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@mistle/ui";
import { Badge } from "@mistle/ui";
import { CpuIcon, HouseIcon, LightningIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { MemoryRouter, NavLink } from "react-router";

import { ErrorNotice } from "../auth/error-notice.js";
import { SessionsNavToggleItem } from "../navigation/sessions-nav-toggle-item.js";
import { AppShellView } from "./app-shell-view.js";
import { OrganizationMenuTrigger } from "./organization-menu-trigger.js";

type AppShellViewStoryArgs = React.ComponentProps<typeof AppShellView> & {
  locationPathname: string;
  showSessionsSidebar: boolean;
};

function HomeNavIcon(props: { className?: string; "aria-hidden"?: boolean }): React.JSX.Element {
  return <HouseIcon {...props} />;
}

function SandboxProfilesNavIcon(props: {
  className?: string;
  "aria-hidden"?: boolean;
}): React.JSX.Element {
  return <CpuIcon {...props} />;
}

function AutomationsNavIcon(props: {
  className?: string;
  "aria-hidden"?: boolean;
}): React.JSX.Element {
  return <LightningIcon {...props} />;
}

function StorySidebarContent(input: {
  locationPathname: string;
  showSessionsSidebar: boolean;
  onShowSessionsSidebarChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <SidebarGroup className="pt-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={input.locationPathname === "/"}
              render={<NavLink to="/" />}
            >
              <HomeNavIcon aria-hidden className="size-4 shrink-0" />
              <span>Home</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={
                input.locationPathname === "/automations" ||
                input.locationPathname.startsWith("/automations/")
              }
              render={<NavLink to="/automations" />}
            >
              <AutomationsNavIcon aria-hidden className="size-4 shrink-0" />
              <span>Automations</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={
                input.locationPathname === "/sandbox-profiles" ||
                input.locationPathname.startsWith("/sandbox-profiles/")
              }
              render={<NavLink to="/sandbox-profiles" />}
            >
              <SandboxProfilesNavIcon aria-hidden className="size-4 shrink-0" />
              <span>Sandbox Profiles</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SessionsNavToggleItem
            checked={input.showSessionsSidebar}
            onCheckedChange={input.onShowSessionsSidebarChange}
          />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function AppShellViewStory(input: AppShellViewStoryArgs): React.JSX.Element {
  const [showSessionsSidebar, setShowSessionsSidebar] = useState(input.showSessionsSidebar);

  useEffect(() => {
    setShowSessionsSidebar(input.showSessionsSidebar);
  }, [input.showSessionsSidebar]);

  return (
    <MemoryRouter initialEntries={[input.locationPathname]} key={input.locationPathname}>
      <AppShellView
        {...input}
        sidebarContent={
          <StorySidebarContent
            locationPathname={input.locationPathname}
            onShowSessionsSidebarChange={setShowSessionsSidebar}
            showSessionsSidebar={showSessionsSidebar}
          />
        }
      />
    </MemoryRouter>
  );
}

/**
 * AppShellView owns the outer dashboard shell contract.
 *
 * Use the two layout dimensions together:
 * - `contentInsetOwner="app-shell"`: the shell provides the standard outer page inset.
 * - `contentInsetOwner="child"`: the child page or child shell provides its own outer spacing and framing.
 * - `viewportMode="document"`: normal document page behavior with regular vertical page flow.
 * - `viewportMode="workspace"`: viewport-managed application surface with fixed height and child-owned internal scrolling.
 *
 * Current usage in the dashboard:
 * - Standard dashboard pages: `app-shell` + `document`.
 * - Settings routes: `child` + `document`.
 * - Session detail routes: `child` + `workspace`.
 */
const meta = {
  title: "Dashboard/Shell/AppShellView",
  component: AppShellViewStory,
  tags: ["autodocs"],
  argTypes: {
    breadcrumbs: {
      control: false,
      description: "Optional header breadcrumb content shown when `showBreadcrumbs` is enabled.",
    },
    contentInsetOwner: {
      control: "inline-radio",
      description:
        "`app-shell` means AppShellView provides the outer page inset. `child` means the page or child shell owns outer spacing and framing.",
      options: ["app-shell", "child"],
    },
    headerActions: {
      control: false,
      description: "Optional header actions rendered on the right side of the sticky header.",
    },
    locationPathname: {
      control: "text",
      description: "Current in-app pathname used to resolve active sidebar item state.",
    },
    mainContent: {
      control: false,
      description: "Primary page content rendered inside the shell content region.",
    },
    showBreadcrumbs: {
      control: "boolean",
      description: "Toggles whether the breadcrumb region is shown in the sticky header.",
    },
    showSessionsSidebar: {
      control: "boolean",
      description: "Toggles the real Sessions sidebar mode switch rendered in the sidebar menu.",
    },
    sidebarContent: {
      control: false,
      description: "Main sidebar navigation content. The story renders the real dashboard sidebar.",
    },
    sidebarFooterContent: {
      control: false,
      description: "Sidebar footer content, typically notices or errors.",
    },
    sidebarHeaderClassName: {
      control: false,
      description: "Optional className override for the sidebar header wrapper.",
    },
    sidebarHeaderContent: {
      control: false,
      description: "Sidebar header content, such as the org switcher or settings back button.",
    },
    topLoadingBar: {
      control: false,
      description: "Top-of-page loading indicator region.",
    },
    viewportMode: {
      control: "inline-radio",
      description:
        "`document` is a normal vertically-growing page. `workspace` is a viewport-managed surface with fixed height and child-owned internal scrolling.",
      options: ["document", "workspace"],
    },
  },
  parameters: {
    layout: "fullscreen",
    controls: {
      include: [
        "contentInsetOwner",
        "viewportMode",
        "showBreadcrumbs",
        "showSessionsSidebar",
        "locationPathname",
        "breadcrumbs",
        "headerActions",
        "mainContent",
        "sidebarHeaderContent",
        "sidebarContent",
        "sidebarFooterContent",
        "topLoadingBar",
        "sidebarHeaderClassName",
      ],
    },
  },
  args: {
    breadcrumbs: <p className="truncate text-sm">Sessions / Storybook Session</p>,
    contentInsetOwner: "app-shell",
    headerActions: (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90" variant="secondary">
        Connected
      </Badge>
    ),
    locationPathname: "/sessions",
    mainContent: (
      <div className="rounded-xl border bg-card p-6 shadow-xs">
        <h2 className="font-semibold text-lg">Storybook shell preview</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          This view isolates the dashboard layout from router, auth, and sign-out orchestration.
        </p>
      </div>
    ),
    showBreadcrumbs: true,
    showSessionsSidebar: false,
    sidebarContent: null,
    sidebarFooterContent: <ErrorNotice message={null} />,
    sidebarHeaderContent: (
      <OrganizationMenuTrigger
        activeOrganizationId="org_mistle"
        isSigningOut={false}
        onSwitchOrganization={function onSwitchOrganization() {}}
        onNavigateToSettings={function onNavigateToSettings() {}}
        onSignOut={function onSignOut() {}}
        organizationSummaryErrorMessage={null}
        organizationSwitcherErrorMessage={null}
        organizationImageUrl={null}
        organizationName="Mistle Labs"
        organizations={[{ id: "org_mistle", name: "Mistle Labs" }]}
      />
    ),
    topLoadingBar: <div className="h-0" />,
    viewportMode: "document",
  },
} satisfies Meta<AppShellViewStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
