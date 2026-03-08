import {
  ChatCircleTextIcon,
  FileCodeIcon,
  GearIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "./badge.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "./sidebar.js";

const meta = {
  title: "UI/Sidebar",
  component: SidebarProvider,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SidebarProvider>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    return (
      <SidebarProvider defaultOpen>
        <Sidebar>
          <SidebarHeader>
            <SidebarInput aria-label="Search sessions" placeholder="Search sessions" />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive tooltip="Home">
                      <HouseIcon />
                      <span>Home</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton tooltip="Sessions">
                      <SparkleIcon />
                      <span>Sessions</span>
                    </SidebarMenuButton>
                    <SidebarMenuBadge>12</SidebarMenuBadge>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton tooltip="Chat">
                      <ChatCircleTextIcon />
                      <span>Chat</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Recent</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <FileCodeIcon />
                      <span>review-openapi-drift</span>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="#overview" isActive>
                          <span>Overview</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="#diffs">
                          <span>Diffs</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Settings">
                  <GearIcon />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <SidebarTrigger />
            <div className="flex items-center gap-2 text-sm">
              <MagnifyingGlassIcon className="text-muted-foreground size-4" />
              Searchable sidebar layout preview
            </div>
            <Badge className="ml-auto" variant="secondary">
              Desktop
            </Badge>
          </div>
          <div className="space-y-4 p-6">
            <h2 className="text-xl font-semibold">Sidebar content area</h2>
            <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
              This story exists to verify the sidebar’s collapsed and expanded layout behavior, menu
              density, and content spacing without pulling in any dashboard routing or session data.
            </p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  },
};

export const Collapsed: Story = {
  render: function Render() {
    return (
      <SidebarProvider defaultOpen={false}>
        <Sidebar>
          <SidebarHeader>
            <SidebarInput aria-label="Search sessions" placeholder="Search sessions" />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive tooltip="Home">
                      <HouseIcon />
                      <span>Home</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton tooltip="Sessions">
                      <SparkleIcon />
                      <span>Sessions</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton tooltip="Settings">
                      <GearIcon />
                      <span>Settings</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <SidebarTrigger />
            <div className="text-sm">Collapsed state preview</div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  },
};
