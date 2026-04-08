import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";

import { withDashboardMemoryRouter, withDashboardPageStory } from "../../storybook/decorators.js";
import { ErrorNotice } from "../auth/error-notice.js";
import { AppShellView } from "../shell/app-shell-view.js";
import { OrganizationMenuTrigger } from "../shell/organization-menu-trigger.js";
import { SessionsNavToggleItem } from "./sessions-nav-toggle-item.js";
import { SessionsSidebarModeControl } from "./sessions-sidebar-mode-control.js";
import {
  buildSessionsSidebarNavGroups,
  type SessionsSidebarSourceItem,
} from "./sessions-sidebar-nav-model.js";
import { SessionsSidebarNav } from "./sessions-sidebar-nav.js";

type SessionsSidebarStoryArgs = {
  items: SessionsSidebarSourceItem[];
};

function SidebarModeAnimatedSection(input: {
  modeKey: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const [animationClassName, setAnimationClassName] = useState("opacity-0");

  useEffect(() => {
    setAnimationClassName("opacity-0");
    const frameId = requestAnimationFrame(() => {
      setAnimationClassName("animate-[sidebar-mode-enter_220ms_ease-out_forwards]");
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [input.modeKey]);

  return <div className={animationClassName}>{input.children}</div>;
}

function SessionsSidebarStory(input: SessionsSidebarStoryArgs): React.JSX.Element {
  const [showSessionsView, setShowSessionsView] = useState(true);
  const groups = buildSessionsSidebarNavGroups(input.items);

  return (
    <AppShellView
      breadcrumbs={<p className="truncate text-sm">Sessions / Sidebar Exploration</p>}
      contentInsetOwner="app-shell"
      headerActions={null}
      mainContent={
        <div className="rounded-xl border bg-card p-6 shadow-xs">
          <h2 className="font-semibold text-lg">Sessions sidebar preview</h2>
          <p className="mt-2 text-muted-foreground text-sm">
            Storybook preview for the alternate left-nav sessions view. The switch is local to the
            story for now.
          </p>
        </div>
      }
      showBreadcrumbs
      sidebarContent={
        <>
          <style>{`
            @keyframes sidebar-mode-enter {
              from {
                opacity: 0;
              }
              to {
                opacity: 1;
              }
            }
          `}</style>
          {showSessionsView ? (
            <SidebarModeAnimatedSection key="sessions" modeKey="sessions">
              <SessionsSidebarModeControl
                checked={showSessionsView}
                onCheckedChange={setShowSessionsView}
              />
              <SessionsSidebarNav groups={groups} />
            </SidebarModeAnimatedSection>
          ) : (
            <SidebarModeAnimatedSection key="app" modeKey="app">
              <SidebarGroup className="pt-0">
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton isActive render={<a href="/" />}>
                        <span>Home</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton render={<a href="/automations" />}>
                        <span>Automations</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton render={<a href="/sandbox-profiles" />}>
                        <span>Sandbox Profiles</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SessionsNavToggleItem
                      checked={showSessionsView}
                      onCheckedChange={setShowSessionsView}
                    />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarModeAnimatedSection>
          )}
        </>
      }
      sidebarFooterContent={<ErrorNotice message={null} />}
      sidebarHeaderContent={
        showSessionsView ? null : (
          <SidebarModeAnimatedSection key="app-header" modeKey="app-header">
            <OrganizationMenuTrigger
              isSigningOut={false}
              onNavigateToSettings={function onNavigateToSettings() {}}
              onSignOut={function onSignOut() {}}
              organizationErrorMessage={null}
              organizationImageUrl={null}
              organizationName="Mistle Labs"
            />
          </SidebarModeAnimatedSection>
        )
      }
      topLoadingBar={<div className="h-0" />}
      viewportMode="document"
    />
  );
}

const meta = {
  title: "Dashboard/Sessions/SidebarNav",
  component: SessionsSidebarStory,
  tags: ["autodocs"],
  decorators: [withDashboardPageStory, withDashboardMemoryRouter],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    items: [
      {
        id: "sbi_working_alpha",
        title:
          "Investigate flaky test run after gateway lease handoff in the repo-maintainer sandbox",
        sandboxProfileId: "sbp_repo_maintainer",
        sandboxProfileDisplayName: "Repo Maintainer",
        status: "running",
        createdAt: "2026-04-08T09:00:00.000Z",
        keepaliveActive: true,
      },
      {
        id: "sbi_ready_alpha",
        title: "Review migration draft",
        sandboxProfileId: "sbp_repo_maintainer",
        sandboxProfileDisplayName: "Repo Maintainer",
        status: "running",
        createdAt: "2026-04-08T08:50:00.000Z",
        keepaliveActive: false,
      },
      {
        id: "sbi_starting_docs",
        title:
          "Draft onboarding guide for new operators working across control plane and gateway runtime flows",
        sandboxProfileId: "sbp_docs",
        sandboxProfileDisplayName: "Docs Maintainer",
        status: "starting",
        createdAt: "2026-04-08T08:40:00.000Z",
        keepaliveActive: false,
      },
      {
        id: "sbi_stopped_finance",
        title: null,
        sandboxProfileId: "sbp_finance",
        sandboxProfileDisplayName: "Finance Investigator",
        status: "stopped",
        createdAt: "2026-04-08T07:30:00.000Z",
        keepaliveActive: false,
      },
      {
        id: "sbi_failed_hidden",
        title: "Hidden failed run",
        sandboxProfileId: "sbp_hidden",
        sandboxProfileDisplayName: "Hidden Profile",
        status: "failed",
        createdAt: "2026-04-08T06:30:00.000Z",
        keepaliveActive: false,
      },
    ],
  },
  render: function RenderStory(args): React.JSX.Element {
    return <SessionsSidebarStory {...args} />;
  },
} satisfies Meta<typeof SessionsSidebarStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedOpenableStates: Story = {};

export const EmptyState: Story = {
  args: {
    items: [
      {
        id: "sbi_failed_only",
        title: "Failed bootstrap",
        sandboxProfileId: "sbp_hidden",
        sandboxProfileDisplayName: "Hidden Profile",
        status: "failed",
        createdAt: "2026-04-08T05:00:00.000Z",
        keepaliveActive: false,
      },
    ],
  },
};
