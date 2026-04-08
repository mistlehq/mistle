import {
  Input,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@mistle/ui";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
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
  const visibleGroups = filterSessionsSidebarNavGroups({
    groups: input.groups,
    searchFilter: {
      searchQuery,
    },
  });

  if (input.groups.length === 0) {
    return <div className="px-4 py-3 text-muted-foreground text-sm">{emptyMessage}</div>;
  }

  return (
    <>
      <div className="px-4 pt-1 pb-2">
        <div className="relative">
          <MagnifyingGlassIcon
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            aria-label="Search sessions"
            className="h-8 border-border/70 bg-background pl-9 text-sm shadow-none"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search sessions"
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
          <SidebarGroupLabel className="h-7 px-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
            {group.profileName}
          </SidebarGroupLabel>
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

    const resizeObserver = new ResizeObserver(updateTruncation);
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [input.label]);

  const labelClassName = "block min-w-0 flex-1 truncate text-sm";

  return (
    <span className={labelClassName} ref={labelRef} title={isTruncated ? input.label : undefined}>
      {input.label}
    </span>
  );
}
