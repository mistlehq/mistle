import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import {
  forwardRef,
  type ReactElement,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

type SessionTerminalRecoverySandboxStatus =
  | "pending"
  | "starting"
  | "running"
  | "resuming"
  | "stopped"
  | "failed"
  | null;

type SessionTerminalWorkspaceProps = {
  cwd: string | null;
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
  isConnectionReady: boolean;
  isVisible: boolean;
  onWorkspaceEmpty: () => void;
  sandboxInstanceId: string;
  sandboxStatus: SessionTerminalRecoverySandboxStatus;
};

export type SessionTerminalWorkspaceHandle = {
  disconnectAllTerminals: () => Promise<void>;
  ensureTerminalWorkspace: () => void;
};

type SessionTerminalDockviewWorkspaceModule =
  typeof import("./session-terminal-dockview-workspace.js");

export const SessionTerminalWorkspace = forwardRef<
  SessionTerminalWorkspaceHandle,
  SessionTerminalWorkspaceProps
>(function SessionTerminalWorkspace(props, forwardedRef): ReactElement | null {
  const [module, setModule] = useState<SessionTerminalDockviewWorkspaceModule | null>(null);
  const workspaceRef = useRef<SessionTerminalWorkspaceHandle | null>(null);

  useEffect(() => {
    if (!props.isVisible) {
      return;
    }

    let isCancelled = false;
    void import("./session-terminal-dockview-workspace.js").then((loadedModule) => {
      if (isCancelled) {
        return;
      }

      setModule(loadedModule);
    });

    return () => {
      isCancelled = true;
    };
  }, [props.isVisible]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      disconnectAllTerminals: async (): Promise<void> => {
        await workspaceRef.current?.disconnectAllTerminals();
      },
      ensureTerminalWorkspace: (): void => {
        workspaceRef.current?.ensureTerminalWorkspace();
      },
    }),
    [],
  );

  if (module === null) {
    return null;
  }

  const DockviewWorkspace = module.SessionTerminalDockviewWorkspace;
  return <DockviewWorkspace {...props} ref={workspaceRef} />;
});
