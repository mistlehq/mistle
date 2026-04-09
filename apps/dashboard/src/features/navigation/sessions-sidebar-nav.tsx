import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import { CaretRightIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";

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
        <SidebarGroup className="gap-1 pb-1" key={group.profileId}>
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
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground group/header flex h-7 w-full items-center justify-between rounded-md px-2 text-[11px] font-semibold tracking-[0.08em] uppercase outline-hidden transition-colors"
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
                <SidebarMenuSub className="mx-0 gap-1 border-l-0 px-0 py-0">
                  {group.items.map((item) => {
                    const isActive = location.pathname === item.to;

                    return (
                      <SidebarMenuSubItem className="w-full" key={item.id}>
                        <SidebarMenuSubButton
                          className="h-auto min-h-9 cursor-default items-center px-2 py-2"
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
  const isActiveSearch = input.hasActiveSearch;
  const containerStateClass = isActiveSearch
    ? "border-border bg-white text-sidebar-accent-foreground"
    : "border-transparent text-foreground hover:border-border hover:bg-white hover:text-muted-foreground focus-within:text-muted-foreground";
  const iconClass = isActiveSearch ? "text-muted-foreground" : "";
  const placeholderClass = isActiveSearch
    ? "placeholder:text-muted-foreground"
    : "placeholder:text-current";

  return (
    <div className="pt-1 pb-1">
      <div
        className={`border-1 flex h-8 items-center gap-2 rounded-md px-2 transition-colors ${containerStateClass}`}
      >
        <MagnifyingGlassIcon aria-hidden className={`size-4 shrink-0 ${iconClass}`} />
        <Input
          aria-label="Search sessions"
          className={`h-full border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 ${placeholderClass}`}
          onChange={(event) => input.onQueryChange(event.target.value)}
          placeholder="Search"
          value={input.query}
        />
      </div>
    </div>
  );
}

function SessionsSidebarItemLabel(input: {
  label: string;
  metadataLabel: string;
}): React.JSX.Element {
  const [labelElement, setLabelElement] = useState<HTMLSpanElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    if (labelElement === null) {
      setIsTruncated(false);
      return;
    }

    const updateTruncation = () => {
      setIsTruncated(labelElement.scrollWidth > labelElement.clientWidth);
    };

    updateTruncation();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(updateTruncation);
    resizeObserver.observe(labelElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [input.label, labelElement]);

  const labelClassName = "block min-w-0 flex-1 truncate text-sm";

  function handleLabelRef(element: HTMLSpanElement | null): void {
    setLabelElement(element);
  }

  return (
    <div className="min-w-0 flex-1">
      <Tooltip disabled={!isTruncated}>
        <TooltipTrigger
          render={
            <span className={labelClassName} ref={handleLabelRef}>
              {input.label}
            </span>
          }
        />
        <TooltipContent showArrow={false} side="top" variant="light">
          {input.label}
        </TooltipContent>
      </Tooltip>
      <div
        className={`pt-0.5 text-[11px] font-medium ${
          input.metadataLabel === "Working" ? "text-sky-700" : "text-muted-foreground"
        }`}
      >
        {input.metadataLabel}
      </div>
    </div>
  );
}
