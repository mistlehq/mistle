import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldContent,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import type {
  ConnectError,
  ConnectOK,
  PTYConnectRequest,
} from "../../lib/sandbox-session-protocol/generated/types.js";
import { resolveApiErrorMessage } from "../api/error-message.js";
import { formatSandboxProfileVersionLabel } from "../sandbox-profiles/format-sandbox-profile-version-label.js";
import {
  sandboxProfilesListQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  listSandboxProfiles,
  listSandboxProfileVersions,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import {
  mintSandboxInstanceConnectionToken,
  startSandboxInstanceFromProfileVersion,
} from "../sessions/sessions-service.js";

const SANDBOX_PROFILE_LIST_LIMIT = 100;
const SESSION_CONNECT_TIMEOUT_MS = 15_000;

const ConnectOkSchema = z
  .object({
    type: z.literal("connect.ok"),
    requestId: z.string().min(1),
  })
  .strict();

const ConnectErrorSchema = z
  .object({
    type: z.literal("connect.error"),
    requestId: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

type ConnectControlMessage = ConnectOK | ConnectError;

type StartSessionStep = "idle" | "starting" | "securing" | "connecting" | "connected";

type ConnectedSession = {
  profileId: string;
  profileVersion: number;
  sandboxInstanceId: string;
  workflowRunId: string;
  connectionUrl: string;
  connectedAtIso: string;
  expiresAtIso: string;
};

export function shouldHandleSocketClose<Socket>(
  activeSocket: Socket | null,
  closingSocket: Socket,
): boolean {
  return activeSocket === closingSocket;
}

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

function resolveStartStepLabel(step: StartSessionStep): string {
  if (step === "starting") {
    return "Starting sandbox...";
  }
  if (step === "securing") {
    return "Securing connection...";
  }
  if (step === "connecting") {
    return "Opening terminal...";
  }
  return "Start session";
}

function parseConnectControlMessage(payload: string): ConnectControlMessage | null {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    return null;
  }

  const parsedConnectOk = ConnectOkSchema.safeParse(parsedPayload);
  if (parsedConnectOk.success) {
    return parsedConnectOk.data;
  }

  const parsedConnectError = ConnectErrorSchema.safeParse(parsedPayload);
  if (parsedConnectError.success) {
    return parsedConnectError.data;
  }

  return null;
}

async function connectSandboxPtySession(input: { connectionUrl: string }): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket(input.connectionUrl);
    const requestId = crypto.randomUUID();
    let settled = false;

    const timeoutId = window.setTimeout(() => {
      failConnection("Timed out while establishing sandbox session connection.");
    }, SESSION_CONNECT_TIMEOUT_MS);

    function cleanupListeners(): void {
      window.clearTimeout(timeoutId);
      websocket.removeEventListener("open", handleOpen);
      websocket.removeEventListener("message", handleMessage);
      websocket.removeEventListener("error", handleError);
      websocket.removeEventListener("close", handleClose);
    }

    function failConnection(message: string): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanupListeners();
      websocket.close();
      reject(new Error(message));
    }

    function completeConnection(): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanupListeners();
      resolve(websocket);
    }

    function handleOpen(): void {
      const connectRequest: PTYConnectRequest = {
        type: "connect",
        v: 1,
        requestId,
        channel: {
          kind: "pty",
          session: "create",
        },
      };

      websocket.send(JSON.stringify(connectRequest));
    }

    function handleMessage(event: MessageEvent): void {
      if (typeof event.data !== "string") {
        return;
      }

      const controlMessage = parseConnectControlMessage(event.data);
      if (controlMessage === null || controlMessage.requestId !== requestId) {
        return;
      }

      if (controlMessage.type === "connect.ok") {
        completeConnection();
        return;
      }

      failConnection(controlMessage.message);
    }

    function handleError(): void {
      failConnection("Sandbox websocket connection failed.");
    }

    function handleClose(): void {
      failConnection("Sandbox websocket connection closed before terminal was ready.");
    }

    websocket.addEventListener("open", handleOpen);
    websocket.addEventListener("message", handleMessage);
    websocket.addEventListener("error", handleError);
    websocket.addEventListener("close", handleClose);
  });
}

export function SessionsPage(): React.JSX.Element {
  const websocketRef = useRef<WebSocket | null>(null);
  const manualDisconnectRef = useRef(false);

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [step, setStep] = useState<StartSessionStep>("idle");
  const [startErrorMessage, setStartErrorMessage] = useState<string | null>(null);
  const [connectedSession, setConnectedSession] = useState<ConnectedSession | null>(null);

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
        ? ["sandbox-profiles", "versions", "none"]
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
  });

  const sortedVersions = useMemo(() => {
    const versions = versionsQuery.data?.versions ?? [];
    return [...versions].sort((left, right) => right.version - left.version);
  }, [versionsQuery.data?.versions]);

  useEffect(() => {
    if (selectedProfileId === null) {
      setSelectedVersion(null);
      return;
    }

    if (versionsQuery.data === undefined) {
      return;
    }

    const versionOptions = versionsQuery.data.versions;
    if (versionOptions.length === 0) {
      setSelectedVersion(null);
      return;
    }

    if (selectedVersion !== null) {
      const hasSelectedVersion = versionOptions.some(
        (candidate) => candidate.version === selectedVersion,
      );
      if (hasSelectedVersion) {
        return;
      }
    }

    setSelectedVersion(resolveLatestVersion(versionOptions));
  }, [selectedProfileId, selectedVersion, versionsQuery.data]);

  useEffect(() => {
    return () => {
      websocketRef.current?.close(1000, "Session page unmounted.");
      websocketRef.current = null;
    };
  }, []);

  function disconnectSession(): void {
    manualDisconnectRef.current = true;
    websocketRef.current?.close(1000, "Disconnected from sessions page.");
    websocketRef.current = null;
    setConnectedSession(null);
    setStep("idle");
    setStartErrorMessage(null);
    manualDisconnectRef.current = false;
  }

  function handleSocketClose(event: CloseEvent): void {
    const closingSocket = event.currentTarget;
    if (!(closingSocket instanceof WebSocket)) {
      return;
    }

    if (!shouldHandleSocketClose(websocketRef.current, closingSocket)) {
      return;
    }

    websocketRef.current = null;
    setConnectedSession(null);
    setStep("idle");
    if (manualDisconnectRef.current) {
      manualDisconnectRef.current = false;
      return;
    }

    setStartErrorMessage("Sandbox session connection closed.");
  }

  const startSessionMutation = useMutation({
    mutationFn: async () => {
      if (selectedProfileId === null) {
        throw new Error("Select a sandbox profile before starting a session.");
      }
      if (selectedVersion === null) {
        throw new Error("Select a profile version before starting a session.");
      }

      disconnectSession();
      setStartErrorMessage(null);
      setStep("starting");

      const startedInstance = await startSandboxInstanceFromProfileVersion({
        profileId: selectedProfileId,
        profileVersion: selectedVersion,
      });

      setStep("securing");
      const mintedConnection = await mintSandboxInstanceConnectionToken({
        instanceId: startedInstance.sandboxInstanceId,
      });

      setStep("connecting");
      const websocket = await connectSandboxPtySession({
        connectionUrl: mintedConnection.connectionUrl,
      });

      return {
        selectedProfileId,
        selectedVersion,
        startedInstance,
        mintedConnection,
        websocket,
      };
    },
    onSuccess: (result) => {
      websocketRef.current = result.websocket;
      manualDisconnectRef.current = false;
      result.websocket.addEventListener("close", handleSocketClose);
      setConnectedSession({
        profileId: result.selectedProfileId,
        profileVersion: result.selectedVersion,
        sandboxInstanceId: result.startedInstance.sandboxInstanceId,
        workflowRunId: result.startedInstance.workflowRunId,
        connectionUrl: result.mintedConnection.connectionUrl,
        connectedAtIso: new Date().toISOString(),
        expiresAtIso: result.mintedConnection.connectionExpiresAt,
      });
      setStep("connected");
      setStartErrorMessage(null);
    },
    onError: (error) => {
      setStep("idle");
      setStartErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not establish sandbox session.",
        }),
      );
    },
  });

  const selectedVersionDisplayText =
    selectedVersion === null
      ? "Select profile version"
      : formatSandboxProfileVersionLabel(selectedVersion);
  const selectedProfileDisplayText =
    selectedProfileId === null
      ? "Select sandbox profile"
      : (profilesQuery.data?.items.find((profile) => profile.id === selectedProfileId)
          ?.displayName ?? "Select sandbox profile");
  const selectedProfileSelectValue = selectedProfileId ?? "";
  const selectedVersionSelectValue = selectedVersion === null ? "" : String(selectedVersion);

  const canStartSession =
    selectedProfileId !== null &&
    selectedVersion !== null &&
    !profilesQuery.isPending &&
    !versionsQuery.isPending &&
    !startSessionMutation.isPending;

  return (
    <div className="gap-4 flex flex-col">
      <Card>
        <CardHeader>
          <CardTitle>Start New Session</CardTitle>
          <CardDescription>
            Select a sandbox profile and version, then establish a sandbox session connection.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4 flex flex-col">
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
              <AlertTitle>Could not load profile versions</AlertTitle>
              <AlertDescription>
                {resolveApiErrorMessage({
                  error: versionsQuery.error,
                  fallbackMessage: "Could not load sandbox profile versions.",
                })}
              </AlertDescription>
            </Alert>
          ) : null}

          {startErrorMessage !== null ? (
            <Alert variant="destructive">
              <AlertTitle>Session start failed</AlertTitle>
              <AlertDescription>{startErrorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="session-start-profile">Sandbox profile</FieldLabel>
            <FieldContent>
              <Select
                disabled={profilesQuery.isPending || (profilesQuery.data?.items.length ?? 0) === 0}
                onValueChange={(value) => {
                  if (value === null || value.length === 0) {
                    setSelectedProfileId(null);
                    return;
                  }
                  setSelectedProfileId(value);
                }}
                value={selectedProfileSelectValue}
              >
                <SelectTrigger aria-label="Sandbox profile" id="session-start-profile">
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
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="session-start-version">Version</FieldLabel>
            <FieldContent>
              <Select
                disabled={
                  selectedProfileId === null ||
                  versionsQuery.isPending ||
                  (versionsQuery.data?.versions.length ?? 0) === 0
                }
                onValueChange={(value) => {
                  if (value === null || value.length === 0) {
                    setSelectedVersion(null);
                    return;
                  }
                  setSelectedVersion(Number(value));
                }}
                value={selectedVersionSelectValue}
              >
                <SelectTrigger aria-label="Sandbox profile version" id="session-start-version">
                  <SelectValue placeholder="Select profile version">
                    {selectedVersionDisplayText}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sortedVersions.map((version) => (
                    <SelectItem key={version.version} value={String(version.version)}>
                      {formatSandboxProfileVersionLabel(version.version)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldContent>
          </Field>

          <div className="gap-2 flex flex-wrap">
            <Button
              disabled={!canStartSession}
              onClick={() => {
                startSessionMutation.mutate();
              }}
              type="button"
            >
              {resolveStartStepLabel(step)}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connection Status</CardTitle>
          <CardDescription>
            {connectedSession === null
              ? "No active sandbox session connection."
              : "Sandbox session connection is established."}
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-2 flex flex-col">
          {connectedSession === null ? (
            <p className="text-muted-foreground text-sm">
              Start a session above to establish a connection.
            </p>
          ) : (
            <>
              <p className="text-sm">
                <span className="font-medium">Status:</span> Connected
              </p>
              <p className="text-sm">
                <span className="font-medium">Sandbox instance:</span>{" "}
                {connectedSession.sandboxInstanceId}
              </p>
              <p className="text-sm">
                <span className="font-medium">Profile:</span> {connectedSession.profileId} (
                {formatSandboxProfileVersionLabel(connectedSession.profileVersion)})
              </p>
              <p className="text-sm">
                <span className="font-medium">Workflow run:</span> {connectedSession.workflowRunId}
              </p>
              <p className="text-sm">
                <span className="font-medium">Connected at:</span>{" "}
                {new Date(connectedSession.connectedAtIso).toLocaleString()}
              </p>
              <p className="text-sm">
                <span className="font-medium">Token expires:</span>{" "}
                {new Date(connectedSession.expiresAtIso).toLocaleString()}
              </p>
              <div className="gap-2 flex flex-wrap">
                <Button onClick={disconnectSession} type="button" variant="outline">
                  Disconnect
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
