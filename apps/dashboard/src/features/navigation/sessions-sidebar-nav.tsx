import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type {
  LaunchableSandboxProfile,
  LaunchableSandboxProfilesResult,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { useLaunchableSandboxProfiles } from "../sandbox-profiles/use-launchable-sandbox-profiles.js";
import { startSandboxInstanceFromProfileVersion } from "../sessions/sessions-service.js";
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
  loadLaunchableProfiles?: (input: {
    signal?: AbortSignal;
  }) => Promise<LaunchableSandboxProfilesResult>;
  startSession?: (input: { profile: LaunchableSandboxProfile }) => Promise<void>;
}): React.JSX.Element {
  const location = useLocation();
  const queryClient = useQueryClient();
  const emptyMessage = input.emptyMessage ?? "No openable sessions yet.";
  const [searchQuery, setSearchQuery] = useState("");
  const [isNewSessionDialogOpen, setIsNewSessionDialogOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [startErrorMessage, setStartErrorMessage] = useState<string | null>(null);
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
  const selectableProfilesQuery = useLaunchableSandboxProfiles({
    enabled: isNewSessionDialogOpen,
    ...(input.loadLaunchableProfiles === undefined
      ? {}
      : { loadLaunchableProfiles: input.loadLaunchableProfiles }),
  });
  const selectableProfiles = selectableProfilesQuery.data?.items ?? [];
  const selectedProfile =
    selectedProfileId === null
      ? null
      : (selectableProfiles.find((profile) => profile.id === selectedProfileId) ?? null);
  const startSessionMutation = useMutation({
    mutationFn: async (profile: LaunchableSandboxProfile) => {
      const startSession =
        input.startSession ??
        (async (startInput: { profile: LaunchableSandboxProfile }) => {
          await startSandboxInstanceFromProfileVersion({
            profileId: startInput.profile.id,
            profileVersion: startInput.profile.latestVersion,
            idempotencyKey: crypto.randomUUID(),
          });
        });

      try {
        await startSession({
          profile,
        });
      } catch (error) {
        if (error instanceof Error && error.message.trim().length > 0) {
          throw new Error(`Starting sandbox instance failed: ${error.message}`);
        }

        throw new Error("Starting sandbox instance failed.");
      }
    },
    onSuccess: async () => {
      setStartErrorMessage(null);
      setSelectedProfileId(null);
      setIsNewSessionDialogOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["sandbox-instances", "list"],
      });
    },
    onError: (error) => {
      setStartErrorMessage(
        error instanceof Error ? error.message : "Could not start sandbox session.",
      );
    },
  });
  const canStartSession =
    selectedProfile !== null &&
    !selectableProfilesQuery.isPending &&
    !startSessionMutation.isPending;
  const selectableProfilesErrorMessage = selectableProfilesQuery.isError
    ? resolveApiErrorMessage({
        error: selectableProfilesQuery.error,
        fallbackMessage: "Could not load sandbox profiles.",
      })
    : null;

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

  useEffect(() => {
    if (selectedProfileId === null || selectableProfilesQuery.isPending) {
      return;
    }

    if (selectableProfiles.some((profile) => profile.id === selectedProfileId)) {
      return;
    }

    setSelectedProfileId(null);
  }, [selectableProfiles, selectableProfilesQuery.isPending, selectedProfileId]);

  function handleNewSessionDialogOpenChange(nextOpen: boolean): void {
    setIsNewSessionDialogOpen(nextOpen);

    if (nextOpen) {
      setStartErrorMessage(null);
      return;
    }

    setSelectedProfileId(null);
    setStartErrorMessage(null);
  }

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                aria-label="Create a new session"
                className=""
                onClick={() => {
                  handleNewSessionDialogOpenChange(true);
                }}
                type="button"
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
      <Dialog
        isBusy={startSessionMutation.isPending}
        isDismissible={!startSessionMutation.isPending}
        onOpenChange={handleNewSessionDialogOpenChange}
        open={isNewSessionDialogOpen}
      >
        {isNewSessionDialogOpen ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New session</DialogTitle>
              <DialogDescription>
                Select a sandbox profile to start a new session.
              </DialogDescription>
            </DialogHeader>

            <Field>
              <FieldLabel htmlFor="new-session-profile-select">Sandbox profile</FieldLabel>
              <FieldContent>
                <Select
                  disabled={
                    selectableProfilesQuery.isPending ||
                    selectableProfiles.length === 0 ||
                    startSessionMutation.isPending
                  }
                  onValueChange={(value) => {
                    setStartErrorMessage(null);
                    if (value === null || value.length === 0) {
                      setSelectedProfileId(null);
                      return;
                    }

                    setSelectedProfileId(value);
                  }}
                  value={selectedProfileId ?? ""}
                >
                  <SelectTrigger className="w-full" id="new-session-profile-select">
                    <SelectValue placeholder="Select sandbox profile">
                      {selectedProfile?.displayName ?? "Select sandbox profile"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {selectableProfiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            {selectableProfilesQuery.isPending ? (
              <p className="text-muted-foreground text-sm">Loading sandbox profiles...</p>
            ) : null}
            {selectableProfilesErrorMessage ? (
              <FieldError errors={[{ message: selectableProfilesErrorMessage }]} />
            ) : null}
            {!selectableProfilesQuery.isPending &&
            !selectableProfilesQuery.isError &&
            selectableProfiles.length === 0 ? (
              <FieldError errors={[{ message: "No launchable sandbox profiles are available." }]} />
            ) : null}
            {startErrorMessage ? <FieldError errors={[{ message: startErrorMessage }]} /> : null}

            <DialogFooter>
              <Button
                disabled={startSessionMutation.isPending}
                onClick={() => {
                  handleNewSessionDialogOpenChange(false);
                }}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={!canStartSession}
                onClick={() => {
                  if (selectedProfile === null) {
                    return;
                  }

                  setStartErrorMessage(null);
                  startSessionMutation.mutate(selectedProfile);
                }}
                type="button"
              >
                {startSessionMutation.isPending ? "Starting sandbox..." : "Start session"}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
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

function SessionsSidebarItemLabel(input: { label: string }): React.JSX.Element {
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
  );
}
