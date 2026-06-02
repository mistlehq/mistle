import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  OverflowTooltipText,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@mistle/ui";
import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { NavLink, useLocation } from "react-router";

import { isNewSessionPath } from "../shell/app-shell-sessions-sidebar-mode.js";
import type {
  SessionsSidebarNavItem,
  SessionsSidebarSourceItem,
} from "./sessions-sidebar-nav-model.js";
import { filterSessionsSidebarNavItems } from "./sessions-sidebar-nav-model.js";

export function SessionsSidebarNav(input: {
  items: readonly SessionsSidebarNavItem[];
  emptyMessage?: string;
}): React.JSX.Element {
  const location = useLocation();
  const emptyMessage = input.emptyMessage ?? "No sessions yet.";
  const [searchQuery, setSearchQuery] = useState("");
  const visibleItems = filterSessionsSidebarNavItems({
    items: input.items,
    searchFilter: {
      searchQuery,
    },
  });
  const hasActiveSearch = searchQuery.trim().length > 0;

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                aria-label="Create a new session"
                isActive={isNewSessionPath(location.pathname)}
                render={<NavLink to="/sessions/new" />}
              >
                <PlusIcon aria-hidden />
                <span>New</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SessionsSidebarSearch
            hasActiveSearch={hasActiveSearch}
            onQueryChange={setSearchQuery}
            query={searchQuery}
          />
        </SidebarGroupContent>
      </SidebarGroup>
      {visibleItems.length === 0 ? (
        <div className="px-4 py-2 text-muted-foreground text-sm">
          {input.items.length === 0 ? emptyMessage : "No sessions match your search."}
        </div>
      ) : null}
      {visibleItems.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2 md:gap-2">
              {visibleItems.map((item) => {
                const isActive = item.to !== undefined && location.pathname === item.to;

                return (
                  <SidebarMenuItem className="w-full" key={item.id}>
                    {item.to === undefined ? (
                      <div className="text-sidebar-foreground rounded-md p-3 text-left md:p-2">
                        <SessionsSidebarItemLabel
                          label={item.label}
                          profileName={item.profileName}
                          status={item.status}
                          updatedAtLabel={item.updatedAtLabel}
                        />
                      </div>
                    ) : (
                      <SidebarMenuButton
                        className="h-auto md:h-auto"
                        isActive={isActive}
                        render={<NavLink to={item.to} />}
                      >
                        <SessionsSidebarItemLabel
                          label={item.label}
                          profileName={item.profileName}
                          status={item.status}
                          updatedAtLabel={item.updatedAtLabel}
                        />
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </>
  );
}

function SessionsSidebarSearch(input: {
  hasActiveSearch: boolean;
  onQueryChange: (query: string) => void;
  query: string;
}): React.JSX.Element {
  return (
    <div className="pt-1 pb-1">
      <InputGroup active={input.hasActiveSearch} variant="inline">
        <InputGroupAddon>
          <MagnifyingGlassIcon aria-hidden className="size-4 shrink-0" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search sessions"
          variant="inline"
          onChange={(event) => input.onQueryChange(event.target.value)}
          placeholder="Search"
          value={input.query}
        />
      </InputGroup>
    </div>
  );
}

function SessionsSidebarItemLabel(input: {
  label: string;
  profileName: string;
  status: SessionsSidebarSourceItem["status"];
  updatedAtLabel: string;
}): React.JSX.Element {
  const isFailed = input.status === "failed";

  return (
    <div className="min-w-0 flex-1">
      <OverflowTooltipText
        className={`min-w-0 flex-1 text-[13px] leading-tight ${isFailed ? "text-muted-foreground" : ""}`}
        text={input.label}
        tooltipSide="right"
        tooltipSideOffset={8}
      />
      <div className="text-muted-foreground flex items-center gap-2 text-xs leading-tight font-medium">
        {isFailed ? <span className="text-destructive">Failed</span> : null}
        <span className="truncate">{input.profileName}</span>
        <span aria-hidden className="shrink-0">
          ·
        </span>
        <span className="shrink-0">{input.updatedAtLabel}</span>
      </div>
    </div>
  );
}
