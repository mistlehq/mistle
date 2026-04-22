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
  Spinner,
} from "@mistle/ui";
import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";

import { isNewSessionPath } from "../shell/app-shell-sessions-sidebar-mode.js";
import type { SessionsSidebarNavItem } from "./sessions-sidebar-nav-model.js";
import { filterSessionsSidebarNavItems } from "./sessions-sidebar-nav-model.js";

export function SessionsSidebarNav(input: {
  items: readonly SessionsSidebarNavItem[];
  emptyMessage?: string;
  headRefresh?: {
    isRefreshing?: boolean;
    label: string;
    onRefresh?: () => void;
  };
  infiniteScroll?: {
    hasMore: boolean;
    onReachEnd?: () => void;
    statusBanner?: {
      kind: "loading";
      label: string;
    };
  };
}): React.JSX.Element {
  const location = useLocation();
  const emptyMessage = input.emptyMessage ?? "No sessions yet.";
  const [searchQuery, setSearchQuery] = useState("");
  const infiniteScrollSentinelRef = useRef<HTMLDivElement | null>(null);
  const visibleItems = filterSessionsSidebarNavItems({
    items: input.items,
    searchFilter: {
      searchQuery,
    },
  });
  const hasActiveSearch = searchQuery.trim().length > 0;

  useEffect(() => {
    if (input.infiniteScroll?.hasMore !== true || input.infiniteScroll.onReachEnd === undefined) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const sentinelElement = infiniteScrollSentinelRef.current;

    if (sentinelElement === null) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          input.infiniteScroll?.onReachEnd?.();
        }
      },
      {
        rootMargin: "160px 0px",
      },
    );

    observer.observe(sentinelElement);

    return () => {
      observer.disconnect();
    };
  }, [input.infiniteScroll?.hasMore, input.infiniteScroll?.onReachEnd, visibleItems.length]);

  useEffect(() => {
    if (
      !hasActiveSearch ||
      visibleItems.length > 0 ||
      input.infiniteScroll?.hasMore !== true ||
      input.infiniteScroll.onReachEnd === undefined ||
      input.infiniteScroll.statusBanner?.kind === "loading"
    ) {
      return;
    }

    input.infiniteScroll.onReachEnd();
  }, [
    hasActiveSearch,
    input.infiniteScroll?.hasMore,
    input.infiniteScroll?.onReachEnd,
    input.infiniteScroll?.statusBanner?.kind,
    visibleItems.length,
  ]);

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
      {input.headRefresh === undefined ? null : (
        <SessionsSidebarHeadRefreshBanner headRefresh={input.headRefresh} />
      )}
      {visibleItems.length === 0 ? (
        <>
          <div className="px-4 py-2 text-muted-foreground text-sm">
            {input.items.length === 0 ? emptyMessage : "No sessions match your search."}
          </div>
          {input.infiniteScroll?.statusBanner === undefined ? null : (
            <div className="px-2 pb-0.5">
              <SessionsSidebarInfiniteScrollStatusBanner
                statusBanner={input.infiniteScroll.statusBanner}
              />
            </div>
          )}
        </>
      ) : (
        <SidebarGroup className="gap-0.5 pb-0.5">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {visibleItems.map((item) => {
                const isActive = location.pathname === item.to;

                return (
                  <SidebarMenuItem className="w-full" key={item.id}>
                    <SidebarMenuButton
                      className="h-auto min-h-8 cursor-default items-center px-2 py-1.5"
                      isActive={isActive}
                      render={<NavLink to={item.to} />}
                    >
                      <div className="flex min-w-0 flex-1 items-center">
                        <SessionsSidebarItemLabel
                          label={item.label}
                          metadataLabel={item.metadataLabel}
                          profileName={item.profileName}
                        />
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
            {input.infiniteScroll === undefined ? null : input.infiniteScroll.hasMore ? (
              <>
                <div aria-hidden className="h-1" ref={infiniteScrollSentinelRef} />
                <SessionsSidebarInfiniteScrollStatusBanner
                  statusBanner={input.infiniteScroll.statusBanner}
                />
              </>
            ) : (
              <SessionsSidebarInfiniteScrollStatusBanner
                statusBanner={input.infiniteScroll.statusBanner}
              />
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  );
}

function SessionsSidebarHeadRefreshBanner(input: {
  headRefresh: {
    isRefreshing?: boolean;
    label: string;
    onRefresh?: () => void;
  };
}): React.JSX.Element {
  return (
    <div className="px-2 pt-0.5 pb-0.5">
      <button
        className="flex w-full items-center justify-between rounded-md border border-sidebar-border/80 px-2 py-1.5 text-left text-[11px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent"
        type="button"
        onClick={() => {
          input.headRefresh.onRefresh?.();
        }}
      >
        <span className="truncate font-medium">{input.headRefresh.label}</span>
        {input.headRefresh.isRefreshing ? (
          <Spinner aria-hidden className="size-3 shrink-0" />
        ) : null}
      </button>
    </div>
  );
}

function SessionsSidebarInfiniteScrollStatusBanner(input: {
  statusBanner:
    | {
        kind: "loading";
        label: string;
      }
    | undefined;
}): React.JSX.Element | null {
  if (input.statusBanner === undefined) {
    return null;
  }

  return (
    <div className="animate-in fade-in-0 slide-in-from-top-1 px-2 pt-2 text-[11px] text-muted-foreground duration-200">
      <div className="flex items-center gap-2">
        <Spinner aria-hidden className="size-3 shrink-0" />
        <span>{input.statusBanner.label}</span>
      </div>
    </div>
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
  profileName: string;
}): React.JSX.Element {
  return (
    <div className="min-w-0 flex-1">
      <OverflowTooltipText
        className="min-w-0 flex-1 text-[13px] leading-tight"
        text={input.label}
      />
      <div className="flex min-w-0 items-center gap-1 pt-px text-[10px] leading-tight">
        <OverflowTooltipText
          className="min-w-0 flex-1 text-muted-foreground"
          text={input.profileName}
        />
        <span aria-hidden className="text-muted-foreground">
          •
        </span>
        <span
          className={`shrink-0 font-medium ${
            input.metadataLabel === "Working" ? "text-sky-700" : "text-muted-foreground"
          }`}
        >
          {input.metadataLabel}
        </span>
      </div>
    </div>
  );
}
