import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import { CaretRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";

import type {
  SessionsSidebarAttentionState,
  SessionsSidebarNavGroup,
} from "./sessions-sidebar-nav-model.js";
import { filterSessionsSidebarNavGroups } from "./sessions-sidebar-nav-model.js";

function resolveAttentionUi(input: SessionsSidebarAttentionState): {
  indicatorClassName: string;
} {
  if (input === "active") {
    return {
      indicatorClassName: "bg-amber-500",
    };
  }

  if (input === "idle") {
    return {
      indicatorClassName: "bg-emerald-600",
    };
  }

  return {
    indicatorClassName: "bg-muted-foreground/45",
  };
}

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

  if (input.groups.length === 0) {
    return <div className="px-4 py-3 text-muted-foreground text-sm">{emptyMessage}</div>;
  }

  return (
    <>
      <div className="px-2 pt-2 pb-1">
        <div className="relative">
          <MagnifyingGlassIcon
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            aria-label="Search sessions"
            className="h-8 border-border/70 bg-background pl-9 text-sm shadow-none"
            onChange={(event) => setSearchQuery(event.target.value)}
            value={searchQuery}
          />
        </div>
      </div>
      {visibleGroups.length === 0 ? (
        <div className="px-4 py-2 text-muted-foreground text-sm">
          No sessions match your search.
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
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground flex h-7 w-full items-center rounded-md px-2 text-[11px] font-semibold tracking-[0.08em] uppercase outline-hidden transition-colors"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <CaretRightIcon
                  aria-hidden
                  className={`size-3 shrink-0 transition-transform ${
                    hasActiveSearch || expandedProfileIds.has(group.profileId) ? "rotate-90" : ""
                  }`}
                />
                <span className="truncate">{group.profileName}</span>
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenuSub className="mx-0 gap-1 border-l-0 px-0 py-0">
                  {group.items.map((item) => {
                    const attentionUi = resolveAttentionUi(item.attentionState);
                    const isActive = location.pathname === item.to;

                    return (
                      <SidebarMenuSubItem className="w-full" key={item.id}>
                        <SidebarMenuSubButton
                          className="h-auto min-h-9 cursor-default items-center px-2 py-2"
                          isActive={isActive}
                          render={<NavLink to={item.to} />}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span
                              aria-hidden
                              className={`size-2.5 shrink-0 rounded-full ${attentionUi.indicatorClassName}`}
                            />
                            <SessionsSidebarItemLabel label={item.label} />
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

function SessionsSidebarItemLabel(input: { label: string }): React.JSX.Element {
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const element = labelRef.current;
    if (element === null) {
      return;
    }

    const updateTruncation = () => {
      setIsTruncated(element.scrollWidth > element.clientWidth);
    };

    updateTruncation();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(updateTruncation);
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [input.label]);

  const labelClassName = "block min-w-0 flex-1 truncate text-sm";

  if (!isTruncated) {
    return (
      <span className={labelClassName} ref={labelRef}>
        {input.label}
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={labelClassName} ref={labelRef}>
            {input.label}
          </span>
        }
      />
      <TooltipContent colorScheme="light" side="top">
        {input.label}
      </TooltipContent>
    </Tooltip>
  );
}
