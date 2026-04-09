import { Badge } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { ErrorNotice } from "../auth/error-notice.js";
import { AppShellView } from "./app-shell-view.js";
import { OrganizationMenuTrigger } from "./organization-menu-trigger.js";

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
  component: AppShellView,
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
    mainContent: {
      control: false,
      description: "Primary page content rendered inside the shell content region.",
    },
    showBreadcrumbs: {
      control: "boolean",
      description: "Toggles whether the breadcrumb region is shown in the sticky header.",
    },
    sidebarContent: {
      control: false,
      description: "Main sidebar navigation content.",
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
        <div className="rounded-md px-3 py-2 text-sm">Integrations</div>
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
        organizationImageUrl={null}
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
