import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfilesListQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  getSandboxProfileVersionIntegrationBindings,
  listSandboxProfiles,
  listSandboxProfileVersions,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import { useSandboxSessionLaunchState } from "../sessions/use-sandbox-session-launch-state.js";
import { formatDateTime } from "../shared/date-formatters.js";

const SANDBOX_PROFILE_LIST_LIMIT = 100;

type SandboxSessionStatus = "starting" | "running" | "stopped" | "failed";

function resolveLatestVersion(versions: readonly { version: number }[]): number | null {
  if (versions.length === 0) {
    return null;
  }

  let latestVersion = versions[0]?.version;
  if (latestVersion === undefined) {
    return null;
  }

  for (const candidate of versions) {
    if (candidate.version > latestVersion) {
      latestVersion = candidate.version;
    }
  }

  return latestVersion;
}

function getSandboxSessionStatusBadgeUi(status: SandboxSessionStatus): {
  label: string;
  variant: "secondary" | "outline" | "destructive";
  className?: string;
} {
  if (status === "running") {
    return {
      label: "Running",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
    };
  }

  if (status === "failed") {
    return {
      label: "Failed",
      variant: "destructive",
    };
  }

  if (status === "stopped") {
    return {
      label: "Stopped",
      variant: "outline",
    };
  }

  return {
    label: "Starting",
    variant: "outline",
  };
}

export function SessionsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const {
    launchedSessions,
    startErrorMessage,
    isStartingSession,
    startSession,
    clearStartErrorMessage,
  } = useSandboxSessionLaunchState();

  const profilesQuery = useQuery({
    queryKey: sandboxProfilesListQueryKey({
      limit: SANDBOX_PROFILE_LIST_LIMIT,
      after: null,
      before: null,
    }),
    queryFn: async ({ signal }) =>
      listSandboxProfiles({
        limit: SANDBOX_PROFILE_LIST_LIMIT,
        after: null,
        before: null,
        signal,
      }),
  });
  const versionsQuery = useQuery({
    queryKey:
      selectedProfileId === null
        ? sandboxProfileVersionsQueryKey("none")
        : sandboxProfileVersionsQueryKey(selectedProfileId),
    queryFn: async ({ signal }) => {
      if (selectedProfileId === null) {
        return { versions: [] };
      }
      return listSandboxProfileVersions({
        profileId: selectedProfileId,
        signal,
      });
    },
    enabled: selectedProfileId !== null,
    retry: false,
  });

  const selectedProfileVersion = useMemo(
    () => resolveLatestVersion(versionsQuery.data?.versions ?? []),
    [versionsQuery.data?.versions],
  );
  const integrationBindingsQuery = useQuery({
    queryKey:
      selectedProfileId === null || selectedProfileVersion === null
        ? sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId: "none",
            version: 0,
          })
        : sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId: selectedProfileId,
            version: selectedProfileVersion,
          }),
    queryFn: async ({ signal }) => {
      if (selectedProfileId === null || selectedProfileVersion === null) {
        return { bindings: [] };
      }

      return getSandboxProfileVersionIntegrationBindings({
        profileId: selectedProfileId,
        version: selectedProfileVersion,
        signal,
      });
    },
    enabled: selectedProfileId !== null && selectedProfileVersion !== null,
    retry: false,
  });
  const hasAgentBinding = (integrationBindingsQuery.data?.bindings ?? []).some(
    (binding) => binding.kind === "agent",
  );

  const selectedProfileDisplayText =
    selectedProfileId === null
      ? "Select sandbox profile"
      : (profilesQuery.data?.items.find((profile) => profile.id === selectedProfileId)
          ?.displayName ?? "Select sandbox profile");
  const selectedProfileSelectValue = selectedProfileId ?? "";

  const canStartSession =
    selectedProfileId !== null &&
    selectedProfileVersion !== null &&
    !profilesQuery.isPending &&
    !versionsQuery.isPending &&
    !integrationBindingsQuery.isPending &&
    !integrationBindingsQuery.isError &&
    hasAgentBinding &&
    !isStartingSession;
  const sortedSessions = [...launchedSessions].sort((left, right) => {
    const statusRank: Record<SandboxSessionStatus, number> = {
      starting: 0,
      running: 1,
      failed: 2,
      stopped: 3,
    };

    const rankDifference = statusRank[left.status] - statusRank[right.status];
    if (rankDifference !== 0) {
      return rankDifference;
    }

    return Date.parse(right.createdAtIso) - Date.parse(left.createdAtIso);
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Start a new session</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            disabled={profilesQuery.isPending || (profilesQuery.data?.items.length ?? 0) === 0}
            onValueChange={(value) => {
              clearStartErrorMessage();
              if (value === null || value.length === 0) {
                setSelectedProfileId(null);
                return;
              }
              setSelectedProfileId(value);
            }}
            value={selectedProfileSelectValue}
          >
            <SelectTrigger
              aria-label="Sandbox profile"
              className="min-w-56"
              id="session-start-profile"
            >
              <SelectValue placeholder="Select sandbox profile">
                {selectedProfileDisplayText}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(profilesQuery.data?.items ?? []).map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!canStartSession}
            onClick={() => {
              if (selectedProfileId === null || selectedProfileVersion === null) {
                return;
              }

              startSession({
                profileId: selectedProfileId,
                profileDisplayName: selectedProfileDisplayText,
                profileVersion: selectedProfileVersion,
              });
            }}
            type="button"
          >
            {isStartingSession ? "Starting sandbox..." : "Start session"}
          </Button>
        </div>

        {profilesQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load sandbox profiles</AlertTitle>
            <AlertDescription>
              {resolveApiErrorMessage({
                error: profilesQuery.error,
                fallbackMessage: "Could not load sandbox profiles.",
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        {versionsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not resolve sandbox profile version</AlertTitle>
            <AlertDescription>
              {resolveApiErrorMessage({
                error: versionsQuery.error,
                fallbackMessage: "Could not load sandbox profile versions.",
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        {integrationBindingsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load integration bindings</AlertTitle>
            <AlertDescription>
              {resolveApiErrorMessage({
                error: integrationBindingsQuery.error,
                fallbackMessage: "Could not load sandbox profile integration bindings.",
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        {selectedProfileId !== null &&
        selectedProfileVersion !== null &&
        !integrationBindingsQuery.isPending &&
        !integrationBindingsQuery.isError &&
        !hasAgentBinding ? (
          <Alert variant="destructive">
            <AlertTitle>Agent Binding Required</AlertTitle>
            <AlertDescription>
              Add an agent integration binding to this sandbox profile version before starting a
              session.
            </AlertDescription>
          </Alert>
        ) : null}
        {startErrorMessage === null ? null : (
          <Alert variant="destructive">
            <AlertTitle>Session start failed</AlertTitle>
            <AlertDescription>{startErrorMessage}</AlertDescription>
          </Alert>
        )}
      </div>

      {launchedSessions.length === 0 ? null : (
        <div className="flex flex-col gap-3">
          {sortedSessions.map((session) => {
            const statusUi = getSandboxSessionStatusBadgeUi(session.status);

            return (
              <div
                className="flex items-start justify-between gap-4 rounded-md border p-4"
                key={session.sandboxInstanceId}
              >
                <div className="min-w-0 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{session.profileDisplayName}</p>
                    <Badge className={statusUi.className} variant={statusUi.variant}>
                      {statusUi.label}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="break-all">
                      <span className="font-medium">Sandbox instance:</span>{" "}
                      {session.sandboxInstanceId}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Started {formatDateTime(session.createdAtIso)}
                    </p>
                  </div>
                  {session.failureMessage === null ? null : (
                    <p className="text-destructive whitespace-pre-wrap text-sm">
                      {session.failureMessage}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <Button
                    disabled={session.status !== "running"}
                    onClick={() => {
                      navigate(`/sessions/${encodeURIComponent(session.sandboxInstanceId)}`);
                    }}
                    type="button"
                  >
                    Open session
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
