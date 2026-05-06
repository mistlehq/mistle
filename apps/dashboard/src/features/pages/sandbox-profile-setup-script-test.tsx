import { SandboxPtyStates, type SandboxPtyState } from "@mistle/sandbox-session-client";
import {
  Button,
  ButtonGroup,
  InlineCode,
  Label,
  Notice,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import {
  CheckCircleIcon,
  PlayIcon,
  SidebarSimpleIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { startSandboxProfileSetupScriptTestRun } from "../sandbox-profiles/sandbox-profiles-service.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import { getSandboxInstanceStatus, stopSandboxInstance } from "../sessions/sessions-service.js";
import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import { NoLoadingIndicatorMeta } from "../shared/loading-indicator-meta.js";
import {
  SandboxBaseRuntimeShell,
  SandboxBaseRuntimeWorkingDirectory,
} from "./sandbox-base-inventory-copy.js";
import { INITIAL_PTY_DIMENSIONS, SessionTerminalSurface } from "./session-terminal-surface.js";
import { useSessionWorkbenchTransport } from "./use-session-workbench-transport.js";

type SetupScriptTestStatus = "blank" | "failed" | "idle" | "running" | "starting" | "success";

type SetupScriptTestViewProps = {
  disabled?: boolean;
  isDraft: boolean;
  onClose?: () => void;
  onFailOnFirstErrorChange?: (checked: boolean) => void;
  onResize?: (dimensions: { cols: number; rows: number }) => Promise<void>;
  onRun?: () => void;
  onWriteInput?: (input: string) => Promise<void>;
  failOnFirstError?: boolean;
  outputChunks?: readonly Uint8Array[];
  outputText?: string;
  ptyLifecycleState?: SandboxPtyState;
  status: SetupScriptTestStatus;
  statusMessage?: string | null;
  setupAssistant?: {
    disabled: boolean;
    isStarting: boolean;
    onClick: () => void;
    title: string;
  };
};

type SetupScriptTestRunnerProps = {
  disabled?: boolean;
  isDraft: boolean;
  profileId: string;
  setupScript: string;
  version: number;
};

type SetupScriptTestRunState = {
  panelProps: SetupScriptTestViewProps;
  buttonProps: SetupScriptTestViewProps;
};

type StartedSetupScriptTestRun = {
  failOnFirstError: boolean;
  ptySessionId: string;
  sandboxInstanceId: string;
  setupScript: string;
};

type SetupScriptTestRunRequest = {
  failOnFirstError: boolean;
  setupScript: string;
};

const SetupScriptTestPtySessionPrefix = "setup-script-test";
const SetupScriptTestSandboxStatusRefetchIntervalMs = 1_000;

const DefaultSetupScriptTestOutput = `$ pnpm install
Lockfile is up to date, resolution step is skipped
Already up to date

$ pnpm dev:bootstrap
Generated .env.local
Database migrations are current
Setup completed in 18.4s`;

const FailedSetupScriptTestOutput = `$ pnpm install
Lockfile is up to date, resolution step is skipped

$ pnpm dev:bootstrap
Missing required environment variable: GITHUB_TOKEN
Setup failed with exit code 1`;

function createSetupScriptTestPtySessionId(): string {
  return `${SetupScriptTestPtySessionPrefix}-${crypto.randomUUID()}`;
}

function encodeSetupScriptBase64(setupScript: string): string {
  const bytes = new TextEncoder().encode(setupScript);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export function createSetupScriptTestShellPayload(input: {
  failOnFirstError: boolean;
  setupScript: string;
}): string {
  const encodedSetupScript = encodeSetupScriptBase64(input.setupScript);
  const shellArgs = input.failOnFirstError ? "-l -e" : "-l";

  return [
    'setup_script_path="$(mktemp /tmp/mistle-setup-script-test.XXXXXX)"',
    'cleanup_setup_script() { rm -f "$setup_script_path"; }',
    "trap cleanup_setup_script EXIT",
    `base64 -d > "$setup_script_path" <<'MISTLE_SETUP_SCRIPT'`,
    encodedSetupScript,
    "MISTLE_SETUP_SCRIPT",
    'chmod 700 "$setup_script_path"',
    'if head -c 2 "$setup_script_path" | grep -q "^#!"; then',
    '  "$setup_script_path"',
    '  exit "$?"',
    "fi",
    `${SandboxBaseRuntimeShell} ${shellArgs} "$setup_script_path"`,
    'exit "$?"',
  ].join("\n");
}

function resolveSetupScriptTestButtonLabel(status: SetupScriptTestStatus): string {
  if (status === "starting") {
    return "Starting...";
  }

  if (status === "running") {
    return "Running...";
  }

  return "Test";
}

function resolveSetupScriptTestButtonIcon(status: SetupScriptTestStatus): React.JSX.Element {
  if (status === "starting" || status === "running") {
    return <SpinnerGapIcon aria-hidden className="size-4 animate-spin" />;
  }

  return <PlayIcon aria-hidden className="size-4" />;
}

function resolveSetupScriptTestButtonTitle(input: {
  disabled: boolean;
  isDraft: boolean;
  status: SetupScriptTestStatus;
}): string {
  if (!input.isDraft) {
    return "Setup script testing is only available while editing a draft.";
  }

  if (input.status === "blank") {
    return "Add a setup script before testing.";
  }

  if (input.status === "starting" || input.status === "running") {
    return "Setup script test is running.";
  }

  if (input.disabled) {
    return "Setup script test is unavailable.";
  }

  return "Test setup script";
}

function resolveSetupScriptTestOutput(input: SetupScriptTestViewProps): string {
  if (input.outputText !== undefined) {
    return input.outputText;
  }

  return input.status === "failed" ? FailedSetupScriptTestOutput : DefaultSetupScriptTestOutput;
}

export function resolveSetupScriptTestStatus(input: {
  isOpenRequested: boolean;
  ptyErrorMessage: string | null;
  ptyExitCode: number | null;
  runErrorMessage: string | null;
  scriptIsBlank: boolean;
  startIsPending: boolean;
  startedRun: StartedSetupScriptTestRun | null;
}): SetupScriptTestStatus {
  if (input.ptyExitCode !== null) {
    return input.ptyExitCode === 0 ? "success" : "failed";
  }

  if (input.runErrorMessage !== null || input.ptyErrorMessage !== null) {
    return "failed";
  }

  if (input.isOpenRequested) {
    return "running";
  }

  if (input.startIsPending || input.startedRun !== null) {
    return "starting";
  }

  if (input.scriptIsBlank) {
    return "blank";
  }

  return "idle";
}

export function resolveSetupScriptTestStatusMessage(input: {
  ptyErrorMessage: string | null;
  runErrorMessage: string | null;
  sandboxFailureMessage: string | null;
}): string | null {
  if (input.runErrorMessage !== null) {
    return input.runErrorMessage;
  }

  if (input.sandboxFailureMessage !== null) {
    return input.sandboxFailureMessage;
  }

  if (input.ptyErrorMessage !== null) {
    return input.ptyErrorMessage;
  }

  return null;
}

function resolveSandboxFailureMessage(input: {
  failureMessage: string | null | undefined;
  status: string | undefined;
}): string | null {
  if (input.status !== "failed") {
    return null;
  }

  return input.failureMessage ?? "Setup script test sandbox failed.";
}

export function SandboxProfileSetupScriptTestButton(
  input: SetupScriptTestViewProps,
): React.JSX.Element {
  const isBusy = input.status === "starting" || input.status === "running";
  const isButtonDisabled =
    input.disabled === true || !input.isDraft || input.status === "blank" || isBusy;

  const failOnFirstErrorSwitchId = "setup-script-test-fail-on-first-error";
  const setupAssistantButton =
    input.setupAssistant === undefined ? null : (
      <Button
        disabled={input.setupAssistant.disabled}
        onClick={input.setupAssistant.onClick}
        size="sm"
        title={input.setupAssistant.title}
        type="button"
        variant="outline"
      >
        {input.setupAssistant.isStarting ? (
          "Starting Setup Assistant..."
        ) : (
          <>
            <SidebarSimpleIcon aria-hidden className="size-4 -scale-x-100" />
            Setup Assistant
          </>
        )}
      </Button>
    );

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <div className="flex items-center gap-2">
        <Switch
          checked={input.failOnFirstError ?? true}
          disabled={isBusy || input.disabled === true || !input.isDraft}
          id={failOnFirstErrorSwitchId}
          onCheckedChange={input.onFailOnFirstErrorChange}
          size="sm"
        />
        <Label className="text-xs normal-case" htmlFor={failOnFirstErrorSwitchId}>
          Fail on error
        </Label>
      </div>
      <ButtonGroup>
        <Button
          disabled={isButtonDisabled}
          onClick={input.onRun}
          size="sm"
          title={resolveSetupScriptTestButtonTitle({
            disabled: input.disabled === true,
            isDraft: input.isDraft,
            status: input.status,
          })}
          type="button"
          variant="outline"
        >
          {resolveSetupScriptTestButtonIcon(input.status)}
          {resolveSetupScriptTestButtonLabel(input.status)}
        </Button>
        {input.setupAssistant === undefined ? null : input.setupAssistant.disabled ? (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              {setupAssistantButton}
            </TooltipTrigger>
            <TooltipContent className="max-w-64 text-left" side="top">
              {input.setupAssistant.title}
            </TooltipContent>
          </Tooltip>
        ) : (
          setupAssistantButton
        )}
      </ButtonGroup>
    </div>
  );
}

export function SandboxProfileSetupScriptTestPanel(
  input: SetupScriptTestViewProps,
): React.JSX.Element | null {
  if (input.status === "idle" || input.status === "blank") {
    return null;
  }

  const isBusy = input.status === "starting" || input.status === "running";
  const isSuccess = input.status === "success";
  const isFailed = input.status === "failed";
  const terminalOutputChunks = input.outputChunks;
  const terminalResize = input.onResize;
  const terminalWriteInput = input.onWriteInput;
  const renderTerminalSurface =
    terminalOutputChunks !== undefined &&
    terminalResize !== undefined &&
    terminalWriteInput !== undefined;

  return (
    <section className="mt-2 overflow-hidden rounded-md border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {isBusy ? (
            <SpinnerGapIcon aria-hidden className="size-4 animate-spin text-muted-foreground" />
          ) : isSuccess ? (
            <CheckCircleIcon aria-hidden className="size-4 text-emerald-700" weight="fill" />
          ) : (
            <WarningCircleIcon aria-hidden className="size-4 text-destructive" weight="fill" />
          )}
          <span className="text-sm font-medium">
            {input.status === "starting"
              ? "Starting test sandbox"
              : input.status === "running"
                ? "Running setup script"
                : input.status === "success"
                  ? "Setup script completed"
                  : "Setup script failed"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <InlineCode variant="muted">Draft test</InlineCode>
          {input.onClose === undefined ? null : (
            <Button
              aria-label="Close setup script test output"
              onClick={input.onClose}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <XIcon aria-hidden className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {isFailed && input.statusMessage !== null && input.statusMessage !== undefined ? (
        <div className="border-b border-border p-3">
          <Notice title="Test failed" variant="alert">
            {input.statusMessage}
          </Notice>
        </div>
      ) : null}

      <div className="h-64 bg-[#132723]">
        {renderTerminalSurface ? (
          <SessionTerminalSurface
            isVisible={true}
            lifecycleState={input.ptyLifecycleState ?? SandboxPtyStates.CLOSED}
            onResize={terminalResize}
            onWriteInput={terminalWriteInput}
            outputChunks={terminalOutputChunks}
          />
        ) : (
          <pre className="h-full overflow-auto p-3 font-mono text-xs leading-5 text-[#dbf1ec]">
            <code>{resolveSetupScriptTestOutput(input)}</code>
          </pre>
        )}
      </div>
    </section>
  );
}

export function useSandboxProfileSetupScriptTestRun(
  input: SetupScriptTestRunnerProps,
): SetupScriptTestRunState {
  const [startedRun, setStartedRun] = useState<StartedSetupScriptTestRun | null>(null);
  const [runErrorMessage, setRunErrorMessage] = useState<string | null>(null);
  const [isOpenRequested, setIsOpenRequested] = useState(false);
  const [failOnFirstError, setFailOnFirstError] = useState(true);
  const openedPtySessionIdRef = useRef<string | null>(null);
  const stoppedSandboxInstanceIdsRef = useRef<ReadonlySet<string>>(new Set());
  const transportManager = useSessionWorkbenchTransport({
    sandboxInstanceId: startedRun?.sandboxInstanceId ?? null,
  });
  const ptyState = useSandboxPtyState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
  });
  const closePty = ptyState.actions.closePty;
  const disconnectPty = ptyState.actions.disconnectPty;
  const openPty = ptyState.actions.openPty;
  const resizePty = ptyState.actions.resizePty;
  const writeInput = ptyState.actions.writeInput;
  const scriptIsBlank = input.setupScript.trim().length === 0;
  const startedRunRef = useRef<StartedSetupScriptTestRun | null>(null);
  const closeActivePtySession = useCallback((): void => {
    if (startedRunRef.current === null) {
      return;
    }

    void closePty().catch(() => {
      void disconnectPty();
    });
  }, [closePty, disconnectPty]);
  const stopCompletedTestSandbox = useCallback(
    (run: StartedSetupScriptTestRun): void => {
      if (stoppedSandboxInstanceIdsRef.current.has(run.sandboxInstanceId)) {
        return;
      }

      stoppedSandboxInstanceIdsRef.current = new Set([
        ...stoppedSandboxInstanceIdsRef.current,
        run.sandboxInstanceId,
      ]);

      void closePty().catch(() => undefined);
      void stopSandboxInstance({
        instanceId: run.sandboxInstanceId,
        idempotencyKey: `setup-script-test-stop:${run.ptySessionId}`,
      }).catch(() => undefined);
    },
    [closePty],
  );
  const startMutation = useMutation({
    meta: NoLoadingIndicatorMeta,
    mutationFn: async (request: SetupScriptTestRunRequest) =>
      startSandboxProfileSetupScriptTestRun({
        idempotencyKey: crypto.randomUUID(),
        profileId: input.profileId,
        setupScript: request.setupScript,
        version: input.version,
      }),
    onSuccess: (result, request) => {
      setRunErrorMessage(null);
      setIsOpenRequested(false);
      openedPtySessionIdRef.current = null;
      const nextStartedRun = {
        failOnFirstError: request.failOnFirstError,
        ptySessionId: createSetupScriptTestPtySessionId(),
        sandboxInstanceId: result.sandboxInstanceId,
        setupScript: request.setupScript,
      };
      startedRunRef.current = nextStartedRun;
      setStartedRun(nextStartedRun);
    },
    onError: (error: unknown) => {
      setRunErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not start setup script test run.",
        }),
      );
    },
  });
  const sandboxStatusQuery = useQuery({
    queryKey:
      startedRun === null
        ? ["sandbox-instance-status", "setup-script-test", null]
        : sandboxInstanceStatusQueryKey(startedRun.sandboxInstanceId),
    meta: NoLoadingIndicatorMeta,
    queryFn: async ({ signal }) => {
      if (startedRun === null) {
        throw new Error("Setup script test sandbox instance id is required.");
      }

      return getSandboxInstanceStatus({
        instanceId: startedRun.sandboxInstanceId,
        signal,
      });
    },
    enabled: startedRun !== null && ptyState.lifecycle.exitInfo === null,
    refetchInterval: (query) =>
      query.state.error !== null ||
      query.state.data?.connectable === true ||
      query.state.data?.status === "failed" ||
      query.state.data?.status === "stopped"
        ? false
        : SetupScriptTestSandboxStatusRefetchIntervalMs,
    retry: false,
  });
  const sandboxFailureMessage = resolveSandboxFailureMessage({
    failureMessage: sandboxStatusQuery.data?.failureMessage,
    status: sandboxStatusQuery.data?.status,
  });
  const sandboxStatusErrorMessage =
    ptyState.lifecycle.exitInfo === null && sandboxStatusQuery.isError
      ? resolveApiErrorMessage({
          error: sandboxStatusQuery.error,
          fallbackMessage: "Could not check setup script test sandbox status.",
        })
      : null;
  const testRunErrorMessage = sandboxFailureMessage ?? sandboxStatusErrorMessage ?? runErrorMessage;
  const status = resolveSetupScriptTestStatus({
    isOpenRequested,
    ptyErrorMessage: ptyState.lifecycle.errorMessage,
    ptyExitCode: ptyState.lifecycle.exitInfo?.exitCode ?? null,
    runErrorMessage: testRunErrorMessage,
    scriptIsBlank,
    startIsPending: startMutation.isPending,
    startedRun,
  });
  const statusMessage = resolveSetupScriptTestStatusMessage({
    ptyErrorMessage: ptyState.lifecycle.errorMessage,
    runErrorMessage: sandboxStatusErrorMessage ?? runErrorMessage,
    sandboxFailureMessage,
  });

  useEffect(() => {
    if (startedRun === null || sandboxStatusQuery.data?.connectable !== true) {
      return;
    }

    if (openedPtySessionIdRef.current === startedRun.ptySessionId) {
      return;
    }

    openedPtySessionIdRef.current = startedRun.ptySessionId;
    setIsOpenRequested(true);

    void openPty({
      ...INITIAL_PTY_DIMENSIONS,
      args: [
        "-lc",
        createSetupScriptTestShellPayload({
          failOnFirstError: startedRun.failOnFirstError,
          setupScript: startedRun.setupScript,
        }),
      ],
      command: SandboxBaseRuntimeShell,
      cwd: SandboxBaseRuntimeWorkingDirectory,
      ptySessionId: startedRun.ptySessionId,
      sandboxInstanceId: startedRun.sandboxInstanceId,
    }).catch((error: unknown) => {
      setRunErrorMessage(
        error instanceof Error ? error.message : "Could not open setup script test terminal.",
      );
    });
  }, [openPty, sandboxStatusQuery.data?.connectable, startedRun]);

  useEffect(() => {
    if (startedRun === null || ptyState.lifecycle.exitInfo === null) {
      return;
    }

    stopCompletedTestSandbox(startedRun);
  }, [ptyState.lifecycle.exitInfo, startedRun, stopCompletedTestSandbox]);

  const handleRun = useCallback((): void => {
    if (
      !input.isDraft ||
      input.disabled === true ||
      scriptIsBlank ||
      status === "starting" ||
      status === "running"
    ) {
      return;
    }

    setRunErrorMessage(null);
    closeActivePtySession();
    setStartedRun(null);
    startedRunRef.current = null;
    openedPtySessionIdRef.current = null;
    setIsOpenRequested(false);
    startMutation.mutate({
      failOnFirstError,
      setupScript: input.setupScript,
    });
  }, [
    closeActivePtySession,
    failOnFirstError,
    input.disabled,
    input.isDraft,
    input.setupScript,
    scriptIsBlank,
    startMutation,
    status,
  ]);

  const handleClose = useCallback((): void => {
    setRunErrorMessage(null);
    closeActivePtySession();
    setStartedRun(null);
    startedRunRef.current = null;
    openedPtySessionIdRef.current = null;
    setIsOpenRequested(false);
  }, [closeActivePtySession]);

  useEffect(() => {
    return () => {
      closeActivePtySession();
    };
  }, [closeActivePtySession]);

  return {
    buttonProps: {
      failOnFirstError,
      isDraft: input.isDraft,
      onFailOnFirstErrorChange: setFailOnFirstError,
      onRun: handleRun,
      status,
      ...(input.disabled === undefined ? {} : { disabled: input.disabled }),
    },
    panelProps: {
      isDraft: input.isDraft,
      onClose: handleClose,
      onResize: resizePty,
      onWriteInput: writeInput,
      outputChunks: ptyState.output.chunks,
      ptyLifecycleState: ptyState.lifecycle.state,
      status,
      statusMessage,
    },
  };
}

export type { SetupScriptTestStatus };
