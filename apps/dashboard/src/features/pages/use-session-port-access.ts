import type { PortsTargetAuthorizeResult, ProcessEntry } from "@mistle/sandbox-session-protocol";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import { useCallback, useMemo, useState } from "react";

import { HttpApiError } from "../api/http-api-error.js";
import { createSandboxInstancePortAccess } from "../sessions/sessions-service.js";
import { openDeferredExternalWindow } from "../shared/external-window.js";
import { createProcessKey, resolvePrimaryProcessListener } from "./session-port-access-model.js";
import { useSessionProcesses } from "./use-session-processes.js";
import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const AuthorizeTimeoutMs = 5_000;

type SessionPortAccessState = {
  buttonDisabledReason: string | null;
  errorMessage: string | null;
  isLoadingProcesses: boolean;
  isOpeningProcessKey: string | null;
  isPanelOpen: boolean;
  observedAt: string | null;
  openProcess: (process: ProcessEntry) => Promise<void>;
  processes: ProcessEntry[];
  setPanelOpen: (open: boolean) => void;
};

function createPortsAuthorizeRequest(port: number): {
  requestId: string;
  payload: string;
} {
  const requestId = crypto.randomUUID();
  return {
    requestId,
    payload: JSON.stringify({
      type: "ports.target.authorize",
      requestId,
      target: {
        kind: "port",
        port,
      },
    }),
  };
}

async function authorizePortAccessTarget(input: {
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
  port: number;
}): Promise<PortsTargetAuthorizeResult> {
  const { transport } = await input.ensureTransportConnected({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const request = createPortsAuthorizeRequest(input.port);

  return await new Promise<PortsTargetAuthorizeResult>((resolve, reject) => {
    const timeoutId: TimerHandle = systemScheduler.schedule(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for sandbox port authorization."));
    }, AuthorizeTimeoutMs);

    const unsubscribe = transport.onEvent((event) => {
      if (event.type !== "unhandled_control") {
        return;
      }

      if (event.message.type !== "ports.target.authorize.result") {
        return;
      }

      if (event.message.requestId !== request.requestId) {
        return;
      }

      systemScheduler.cancel(timeoutId);
      unsubscribe();
      resolve(event.message);
    });

    void transport.sendTextMessage(request.payload).catch((error) => {
      systemScheduler.cancel(timeoutId);
      unsubscribe();
      reject(
        error instanceof Error ? error : new Error("Could not send sandbox port authorization."),
      );
    });
  });
}

function normalizePortAccessError(error: unknown): string {
  if (error instanceof HttpApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Could not open sandbox port access.";
}

function resolveAuthorizeFailureMessage(
  result: Extract<PortsTargetAuthorizeResult, { authorized: false }>,
): string {
  switch (result.reason) {
    case "port_unreachable":
      return "That port is no longer reachable in the sandbox.";
    case "unsupported_protocol":
      return "That process is not serving HTTP or HTTPS on its selected port.";
    case "bootstrap_disconnected":
      return "The sandbox tunnel disconnected before port access could be authorized.";
  }

  throw new Error("Unknown port access authorize failure reason.");
}

export function useSessionPortAccess(input: {
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string | null;
  stoppedSessionMessage: string | null;
  canConnect: boolean;
}): SessionPortAccessState {
  const [isPanelOpen, setPanelOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openingProcessKey, setOpeningProcessKey] = useState<string | null>(null);

  const buttonDisabledReason = useMemo(() => {
    if (input.sandboxInstanceId === null) {
      return "Session id is required.";
    }

    if (!input.canConnect) {
      return (
        input.stoppedSessionMessage ?? "Processes are available only when the sandbox is running."
      );
    }

    return null;
  }, [input.canConnect, input.sandboxInstanceId, input.stoppedSessionMessage]);

  const processesState = useSessionProcesses({
    enabled: isPanelOpen && buttonDisabledReason === null,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  const openProcess = useCallback(
    async (process: ProcessEntry): Promise<void> => {
      const sandboxInstanceId = input.sandboxInstanceId;
      if (sandboxInstanceId === null) {
        setErrorMessage("Session id is required.");
        return;
      }

      const primaryListener = resolvePrimaryProcessListener(process);
      if (primaryListener === null) {
        setErrorMessage("This process does not expose a loopback listener.");
        return;
      }

      const openedWindow = openDeferredExternalWindow({
        loadingMessage: "Opening sandbox port…",
        title: "Opening sandbox port…",
      });
      if (openedWindow === null) {
        setErrorMessage("Browser blocked opening a new tab.");
        return;
      }

      const processKey = createProcessKey(process);
      setOpeningProcessKey(processKey);
      setErrorMessage(null);

      try {
        const authorizeResult = await authorizePortAccessTarget({
          ensureTransportConnected: input.ensureTransportConnected,
          sandboxInstanceId,
          port: primaryListener.port,
        });
        if (!authorizeResult.authorized) {
          throw new Error(resolveAuthorizeFailureMessage(authorizeResult));
        }

        const access = await createSandboxInstancePortAccess({
          instanceId: sandboxInstanceId,
          port: primaryListener.port,
        });
        openedWindow.navigate(access.url);
      } catch (error) {
        openedWindow.close();
        setErrorMessage(normalizePortAccessError(error));
      } finally {
        setOpeningProcessKey(null);
      }
    },
    [input.ensureTransportConnected, input.sandboxInstanceId],
  );

  const openPanel = useCallback(() => {
    if (buttonDisabledReason !== null) {
      return;
    }

    setErrorMessage(null);
    setPanelOpen(true);
  }, [buttonDisabledReason]);

  const setControlledPanelOpen = useCallback(
    (open: boolean) => {
      if (!open) {
        setPanelOpen(false);
        return;
      }

      openPanel();
    },
    [openPanel],
  );

  return {
    buttonDisabledReason,
    errorMessage: errorMessage ?? processesState.errorMessage,
    isLoadingProcesses: processesState.isLoading,
    isOpeningProcessKey: openingProcessKey,
    isPanelOpen,
    observedAt: processesState.observedAt,
    openProcess,
    processes: processesState.processes,
    setPanelOpen: setControlledPanelOpen,
  };
}

export type { SessionPortAccessState };
