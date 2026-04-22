import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  OverflowTooltipText,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@mistle/ui";
import { CaretRightIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";

import { isNewSessionPath } from "../shell/app-shell-sessions-sidebar-mode.js";
import type { SessionsSidebarNavGroup } from "./sessions-sidebar-nav-model.js";
import { filterSessionsSidebarNavGroups } from "./sessions-sidebar-nav-model.js";

export function SessionsSidebarNav(input: {
  groups: readonly SessionsSidebarNavGroup[];
  emptyMessage?: string;
}): React.JSX.Element {
  const location = useLocation();
  const emptyMessage = input.emptyMessage ?? "No openable sessions yet.";
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProfileIds, setExpandedProfileIds] = useState(
    () => new Set(input.groups.map((group) => group.profileId)),
  );
  const visibleGroups = filterSessionsSidebarNavGroups({
    groups: input.groups,
    searchFilter: {
      searchQuery,
    },
  });
  const hasActiveSearch = searchQuery.trim().length > 0;

  useEffect(() => {
    setExpandedProfileIds((currentExpandedProfileIds) => {
      let hasAddedProfile = false;
      const nextExpandedProfileIds = new Set(currentExpandedProfileIds);

      for (const group of input.groups) {
        if (nextExpandedProfileIds.has(group.profileId)) {
          continue;
        }

        nextExpandedProfileIds.add(group.profileId);
        hasAddedProfile = true;
      }

      return hasAddedProfile ? nextExpandedProfileIds : currentExpandedProfileIds;
    });
  }, [input.groups]);

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
      {visibleGroups.length === 0 ? (
        <div className="px-4 py-2 text-muted-foreground text-sm">
          {input.groups.length === 0 ? emptyMessage : "No sessions match your search."}
        </div>
      ) : null}
      {visibleGroups.map((group) => (
        <SidebarGroup className="gap-0.5 pb-0.5" key={group.profileId}>
          <Collapsible
            onOpenChange={(open) => {
              setExpandedProfileIds((currentExpandedProfileIds) => {
                const nextExpandedProfileIds = new Set(currentExpandedProfileIds);

                if (open) {
                  nextExpandedProfileIds.add(group.profileId);
                } else {
                  nextExpandedProfileIds.delete(group.profileId);
                }

                return nextExpandedProfileIds;
              });
            }}
            open={hasActiveSearch || expandedProfileIds.has(group.profileId)}
          >
            <CollapsibleTrigger
              aria-label={`Toggle ${group.profileName} sessions`}
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground group/header flex h-6 w-full items-center justify-between rounded-md px-2 text-[10px] font-semibold tracking-[0.08em] uppercase outline-hidden transition-colors"
            >
              <span className="truncate">{group.profileName}</span>
              <CaretRightIcon
                aria-hidden
                className={`pointer-events-none size-3 shrink-0 opacity-0 transition-[opacity,transform] group-hover/header:opacity-100 ${
                  hasActiveSearch || expandedProfileIds.has(group.profileId) ? "rotate-90" : ""
                }`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenuSub className="mx-0 gap-0.5 border-l-0 px-0 py-0">
                  {group.items.map((item) => {
                    const isActive = location.pathname === item.to;

                    return (
                      <SidebarMenuSubItem className="w-full" key={item.id}>
                        <SidebarMenuSubButton
                          className="h-auto min-h-8 cursor-default items-center px-2 py-1.5"
                          isActive={isActive}
                          render={<NavLink to={item.to} />}
                        >
                          <div className="flex min-w-0 flex-1 items-center">
                            <SessionsSidebarItemLabel
                              label={item.label}
                              metadataLabel={item.metadataLabel}
                            />
                          </div>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>
      ))}
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
  metadataLabel: string;
}): React.JSX.Element {
  return (
    <div className="min-w-0 flex-1">
      <OverflowTooltipText
        className="min-w-0 flex-1 text-[13px] leading-tight"
        text={input.label}
        tooltipSide="right"
        tooltipSideOffset={8}
      />
      <div
        className={`pt-px text-[10px] leading-tight font-medium ${
          input.metadataLabel === "Working" ? "text-sky-700" : "text-muted-foreground"
        }`}
      >
        {input.metadataLabel}
      </div>
    </div>
  );
}
