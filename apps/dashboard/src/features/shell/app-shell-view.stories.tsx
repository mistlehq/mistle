import { Badge } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { ErrorNotice } from "../auth/error-notice.js";
import { AppShellView } from "./app-shell-view.js";
import { OrganizationMenuTrigger } from "./organization-menu-trigger.js";

const meta = {
  title: "Dashboard/Shell/AppShellView",
  component: AppShellView,
  tags: ["autodocs"],
  argTypes: {
    breadcrumbs: {
      control: false,
    },
    contentInsetOwner: {
      control: "inline-radio",
      options: ["app-shell", "child"],
    },
    headerActions: {
      control: false,
    },
    mainContent: {
      control: false,
    },
    showBreadcrumbs: {
      control: "boolean",
    },
    sidebarContent: {
      control: false,
    },
    sidebarFooterContent: {
      control: false,
    },
    sidebarHeaderClassName: {
      control: false,
    },
    sidebarHeaderContent: {
      control: false,
    },
    topLoadingBar: {
      control: false,
    },
    viewportMode: {
      control: "inline-radio",
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
    mainContent: (
      <div className="rounded-xl border bg-card p-6 shadow-xs">
        <h2 className="font-semibold text-lg">Storybook shell preview</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          This view isolates the dashboard layout from router, auth, and sign-out orchestration.
        </p>
      </div>
    ),
    showBreadcrumbs: true,
    sidebarContent: (
      <div className="space-y-1 px-2">
        <div className="rounded-md bg-muted px-3 py-2 text-sm">Home</div>
        <div className="rounded-md px-3 py-2 text-sm">Sandbox Profiles</div>
        <div className="rounded-md px-3 py-2 text-sm">Sessions</div>
      </div>
    ),
    sidebarFooterContent: <ErrorNotice message={null} />,
    sidebarHeaderContent: (
      <OrganizationMenuTrigger
        isSigningOut={false}
        onNavigateToSettings={function onNavigateToSettings() {}}
        onSignOut={function onSignOut() {}}
        organizationErrorMessage={null}
        organizationName="Mistle Labs"
      />
    ),
    topLoadingBar: <div className="h-0" />,
    viewportMode: "document",
  },
} satisfies Meta<typeof AppShellView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
