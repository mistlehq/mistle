import {
  Button,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@mistle/ui";
import { DotsThreeIcon, PencilSimpleIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";

import { ErrorNotice } from "../auth/error-notice.js";
import { AppShellView } from "../shell/app-shell-view.js";
import { OrganizationMenuTrigger } from "../shell/organization-menu-trigger.js";
import { ConversationWorkspaceFrame } from "./conversation-workspace-frame.js";
import { PageFrame } from "./page-frame.js";

type PageFrameShellPattern =
  | "form-title"
  | "form-breadcrumbs"
  | "normal-title"
  | "normal-breadcrumbs"
  | "tabbed"
  | "full"
  | "workspace";

type PageFrameShellPatternsStoryArgs = {
  pattern: PageFrameShellPattern;
  sidebarDefaultOpen: boolean;
};

function PageFrameShellPatternsStory(input: PageFrameShellPatternsStoryArgs): React.JSX.Element {
  const isWorkspace = input.pattern === "workspace";

  return (
    <MemoryRouter initialEntries={["/storybook/page-frame-shell-patterns"]}>
      <AppShellView
        contentInsetOwner="child"
        mainContent={renderPattern(input.pattern)}
        renderSidebarTrigger={!isWorkspace}
        sidebarContent={<StorySidebarContent />}
        sidebarDefaultOpen={input.sidebarDefaultOpen}
        sidebarFooterContent={<ErrorNotice message={null} />}
        sidebarHeaderContent={
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
        }
        topLoadingBar={<div className="h-0" />}
        viewportMode={isWorkspace ? "workspace" : "document"}
      />
    </MemoryRouter>
  );
}

function StorySidebarContent(): React.JSX.Element {
  return (
    <SidebarGroup className="pt-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive>
              <span>Page frames</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <span>Workspace</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function renderPattern(pattern: PageFrameShellPattern): React.ReactNode {
  switch (pattern) {
    case "form-title":
      return (
        <PageFrame width="form" title="Profile">
          <FormFixture />
        </PageFrame>
      );
    case "form-breadcrumbs":
      return (
        <PageFrame
          breadcrumbs={<BreadcrumbFixture items={["Integrations", "GitHub", "Add"]} />}
          description="Configure a provider connection."
          title="Add GitHub Connection"
          width="form"
        >
          <FormFixture />
        </PageFrame>
      );
    case "normal-title":
      return (
        <PageFrame description="Recent sandbox-backed sessions." title="Sessions" width="normal">
          <ListFixture />
        </PageFrame>
      );
    case "normal-breadcrumbs":
      return (
        <PageFrame
          breadcrumbs={<BreadcrumbFixture items={["Integrations", "GitHub"]} />}
          headerActions={
            <Button type="button" variant="outline">
              Manage
            </Button>
          }
          titleSlot={<EditableTitleFixture value="GH" />}
          width="normal"
        >
          <DetailFixture />
        </PageFrame>
      );
    case "tabbed":
      return (
        <PageFrame
          headerActions={
            <Button size="icon" type="button" variant="ghost">
              <DotsThreeIcon aria-hidden />
            </Button>
          }
          titleSlot={<EditableTitleFixture value="Sandbox Profile" />}
          variant="tabbed"
          width="normal"
        >
          <TabbedFixture />
        </PageFrame>
      );
    case "full":
      return (
        <PageFrame description="A full-width operational page." title="Session Runs" width="full">
          <WideFixture />
        </PageFrame>
      );
    case "workspace":
      return (
        <ConversationWorkspaceFrame
          actions={
            <Button size="sm" type="button" variant="ghost">
              TUI
            </Button>
          }
          leadingControl={
            <Button aria-label="Toggle sidebar" size="icon" type="button" variant="ghost">
              <SidebarSimpleIcon aria-hidden />
            </Button>
          }
          title="Session workspace"
        >
          <div className="flex h-full items-center justify-center bg-background">
            <div className="rounded border bg-card px-6 py-5 text-sm shadow-xs">
              Workspace content
            </div>
          </div>
        </ConversationWorkspaceFrame>
      );
  }
}

function BreadcrumbFixture(input: { items: string[] }): React.JSX.Element {
  return (
    <nav aria-label="Page breadcrumbs" className="flex min-w-0 items-center gap-2 text-sm">
      {input.items.map((item, index) => (
        <span className="flex min-w-0 items-center gap-2" key={item}>
          {index === 0 ? null : <span className="text-muted-foreground">/</span>}
          <span
            className={index === input.items.length - 1 ? "font-medium" : "text-muted-foreground"}
          >
            {item}
          </span>
        </span>
      ))}
    </nav>
  );
}

function EditableTitleFixture(input: { value: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <h1 className="truncate text-xl font-semibold">{input.value}</h1>
      <PencilSimpleIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

function FormFixture(): React.JSX.Element {
  return (
    <div className="divide-y rounded border bg-white">
      <FixtureRow label="Display name" value="jonathan@mistle.dev" />
      <FixtureRow label="Email" value="jonathan@mistle.dev" muted />
      <FixtureRow label="Role" value="Owner" />
    </div>
  );
}

function DetailFixture(): React.JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
      <aside className="border-l-2 border-foreground pl-4">
        <p className="font-medium">GH</p>
        <p className="text-muted-foreground text-sm">GitHub App installation</p>
      </aside>
      <section className="space-y-4 border-l pl-8">
        <SectionHeading>Installation</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <MetricFixture label="App ID" value="3606593" />
          <MetricFixture label="App slug" value="jlocalgithub" />
        </div>
      </section>
    </div>
  );
}

function ListFixture(): React.JSX.Element {
  return (
    <div className="divide-y rounded border bg-white">
      {["Fix flaky deploy", "Review billing migration", "Update support docs"].map((item) => (
        <div className="flex items-center justify-between px-4 py-3" key={item}>
          <span className="font-medium">{item}</span>
          <span className="text-muted-foreground text-sm">Ready</span>
        </div>
      ))}
    </div>
  );
}

function TabbedFixture(): React.JSX.Element {
  return (
    <div className="min-h-full border-t bg-background px-6 py-8">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="flex gap-6 border-b">
          <span className="border-foreground border-b-2 pb-3 font-medium">Sandbox Profile</span>
          <span className="text-muted-foreground pb-3 font-medium">Snapshots</span>
        </div>
        <WideFixture />
      </div>
    </div>
  );
}

function WideFixture(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <SectionHeading>Resources & Tools</SectionHeading>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded border bg-white p-4">Codex</div>
        <div className="rounded border bg-white p-4">GitHub</div>
        <div className="rounded border bg-white p-4">Repository access</div>
      </div>
    </div>
  );
}

function FixtureRow(input: { label: string; value: string; muted?: boolean }): React.JSX.Element {
  return (
    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[10rem_1fr]">
      <span className="text-muted-foreground text-sm font-medium uppercase">{input.label}</span>
      <span className={input.muted === true ? "text-muted-foreground" : "font-medium"}>
        {input.value}
      </span>
    </div>
  );
}

function MetricFixture(input: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className="text-muted-foreground text-sm font-medium uppercase">{input.label}</p>
      <p className="mt-1 text-lg">{input.value}</p>
    </div>
  );
}

function SectionHeading(input: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-4">
      <h2 className="text-base font-semibold uppercase">{input.children}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

const meta = {
  title: "Dashboard/Shared/PageFrame Shell Patterns",
  component: PageFrameShellPatternsStory,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    pattern: {
      control: "select",
      options: [
        "form-title",
        "form-breadcrumbs",
        "normal-title",
        "normal-breadcrumbs",
        "tabbed",
        "full",
        "workspace",
      ],
    },
    sidebarDefaultOpen: {
      control: "boolean",
    },
  },
  args: {
    pattern: "form-title",
    sidebarDefaultOpen: false,
  },
} satisfies Meta<PageFrameShellPatternsStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Patterns: Story = {};
