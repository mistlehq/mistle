import { Button, ButtonGroup, Notice, Tooltip, TooltipContent, TooltipTrigger } from "@mistle/ui";
import {
  CheckCircleIcon,
  PlayIcon,
  SidebarSimpleIcon,
  SpinnerGapIcon,
  StopIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  startSandboxProfileMaintenanceScriptTestRun,
  startSandboxProfileSetupScriptTestRun,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type {
  SandboxProfileMaintenanceScriptTestRun,
  SandboxProfileSetupScriptTestRuntimeConfig,
  SandboxProfileSetupScriptTestRun,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import {
  getSandboxInstanceStatus,
  stopSandboxInstance,
  type SandboxInstanceStatusResult,
} from "../sessions/sessions-service.js";
import { NoLoadingIndicatorMeta } from "../shared/loading-indicator-meta.js";
import { SandboxOperationProgress } from "./sandbox-operation-progress.js";

type SetupScriptTestStatus = "blank" | "failed" | "idle" | "running" | "starting" | "success";

export type SetupScriptTestButtonProps = {
  canRun: boolean;
  disabled?: boolean;
  labels?: ScriptTestLabels;
  onRun?: () => void;
  onStop?: () => void;
  status: SetupScriptTestStatus;
  setupAssistant?: {
    disabled: boolean;
    isStarting: boolean;
    onClick: () => void;
    title: string;
  };
};

type SetupScriptTestPanelProps = {
  labels?: ScriptTestLabels;
  onClose?: () => void;
  operationProgress?: ReactNode;
  status: SetupScriptTestStatus;
  statusMessage?: string | null;
};

type SetupScriptTestRunnerProps = {
  disabled?: boolean;
  isDraft: boolean;
  buildRuntimeConfig?: () => SandboxProfileSetupScriptTestRuntimeConfig;
  profileId: string;
  setupScript: string;
  version: number;
};

type MaintenanceScriptTestRunnerProps = {
  canRun: boolean;
  disabled?: boolean;
  maintenanceScript: string;
  profileId: string;
  version: number;
};

type ScriptTestLabels = {
  addScriptTitle: string;
  closeOutputLabel: string;
  completedLabel: string;
  disabledTitle: string;
  failedLabel: string;
  failureFallbackMessage: string;
  runningLabel: string;
  runningTitle: string;
  startErrorFallbackMessage: string;
  startingTitle: string;
  statusErrorFallbackMessage: string;
  stopIdempotencyPrefix: string;
  stopTitle: string;
  testButtonLabel: string;
  testTitle: string;
  unavailableTitle: string;
  waitingMessage: string;
};

type SetupScriptTestRunState = {
  panelProps: SetupScriptTestPanelProps;
  buttonProps: SetupScriptTestButtonProps;
};

type StartedSetupScriptTestRun = {
  sandboxInstanceId: string;
  setupScript: string;
  workflowRunId: string;
};

type SetupScriptTestRunRequest = {
  runtimeConfig?: SandboxProfileSetupScriptTestRuntimeConfig;
  script: string;
};

type SetupScriptTestTerminalResult = "success" | null;

const SetupScriptTestSandboxStatusRefetchIntervalMs = 1_000;
const SetupScriptTestLabels: ScriptTestLabels = {
  addScriptTitle: "Add a setup script before testing.",
  closeOutputLabel: "Close setup script test output",
  completedLabel: "Setup script completed",
  disabledTitle: "Setup script test is unavailable.",
  failedLabel: "Setup script failed",
  failureFallbackMessage: "Setup script test sandbox failed.",
  runningLabel: "Running setup script",
  runningTitle: "Setup script test is running.",
  startErrorFallbackMessage: "Could not start setup script test run.",
  startingTitle: "Setup script test is starting.",
  statusErrorFallbackMessage: "Could not check setup script test sandbox status.",
  stopIdempotencyPrefix: "setup-script-test-stop",
  stopTitle: "Stop setup script test.",
  testButtonLabel: "Test",
  testTitle: "Test setup script",
  unavailableTitle: "Setup script testing is only available while editing a draft.",
  waitingMessage: "Waiting for setup-check sandbox startup events.",
};
const MaintenanceScriptTestLabels: ScriptTestLabels = {
  addScriptTitle: "Add a snapshot maintenance script before testing.",
  closeOutputLabel: "Close snapshot maintenance script test output",
  completedLabel: "Snapshot maintenance script completed",
  disabledTitle: "Snapshot maintenance script test is unavailable.",
  failedLabel: "Snapshot maintenance script failed",
  failureFallbackMessage: "Snapshot maintenance script test sandbox failed.",
  runningLabel: "Running snapshot maintenance script",
  runningTitle: "Snapshot maintenance script test is running.",
  startErrorFallbackMessage: "Could not start snapshot maintenance script test run.",
  startingTitle: "Snapshot maintenance script test is starting.",
  statusErrorFallbackMessage: "Could not check snapshot maintenance script test sandbox status.",
  stopIdempotencyPrefix: "maintenance-script-test-stop",
  stopTitle: "Stop snapshot maintenance script test.",
  testButtonLabel: "Test",
  testTitle: "Test snapshot maintenance script",
  unavailableTitle: "Snapshot maintenance script testing requires a usable snapshot.",
  waitingMessage: "Waiting for maintenance-check sandbox startup events.",
};

function resolveSetupScriptTestButtonLabel(input: {
  canStop: boolean;
  labels: ScriptTestLabels;
  status: SetupScriptTestStatus;
}): string {
  if (input.canStop) {
    return "Stop";
  }

  if (input.status === "starting") {
    return "Starting...";
  }

  if (input.status === "running") {
    return "Running...";
  }

  return input.labels.testButtonLabel;
}

function resolveSetupScriptTestButtonIcon(input: {
  canStop: boolean;
  status: SetupScriptTestStatus;
}): React.JSX.Element {
  if (input.status === "starting" && !input.canStop) {
    return <SpinnerGapIcon aria-hidden className="size-4 animate-spin" />;
  }

  if (input.canStop) {
    return <StopIcon aria-hidden className="size-4" weight="fill" />;
  }

  return <PlayIcon aria-hidden className="size-4" />;
}

function resolveSetupScriptTestButtonTitle(input: {
  canStop: boolean;
  canRun: boolean;
  disabled: boolean;
  labels: ScriptTestLabels;
  status: SetupScriptTestStatus;
}): string {
  if (!input.canRun) {
    return input.labels.unavailableTitle;
  }

  if (input.status === "blank") {
    return input.labels.addScriptTitle;
  }

  if (input.canStop) {
    return input.labels.stopTitle;
  }

  if (input.status === "starting") {
    return input.labels.startingTitle;
  }

  if (input.status === "running") {
    return input.labels.runningTitle;
  }

  if (input.disabled) {
    return input.labels.disabledTitle;
  }

  return input.labels.testTitle;
}

export function resolveSetupScriptTestStatus(input: {
  runErrorMessage: string | null;
  sandboxStatus: SandboxInstanceStatusResult["status"] | null;
  scriptIsBlank: boolean;
  startIsPending: boolean;
  startedRun: StartedSetupScriptTestRun | null;
  terminalResult: SetupScriptTestTerminalResult;
}): SetupScriptTestStatus {
  if (input.terminalResult === "success") {
    return "success";
  }

  if (
    input.startedRun !== null &&
    (input.sandboxStatus === "running" || input.sandboxStatus === "stopped")
  ) {
    return "success";
  }

  if (
    input.runErrorMessage !== null ||
    input.sandboxStatus === "failed" ||
    input.sandboxStatus === "stopped"
  ) {
    return "failed";
  }

  if (input.startIsPending || input.startedRun !== null) {
    return input.sandboxStatus === null || input.sandboxStatus === "pending"
      ? "starting"
      : "running";
  }

  if (input.scriptIsBlank) {
    return "blank";
  }

  return "idle";
}

export function resolveSetupScriptTestStatusMessage(input: {
  runErrorMessage: string | null;
  sandboxFailureMessage: string | null;
}): string | null {
  if (input.runErrorMessage !== null) {
    return input.runErrorMessage;
  }

  if (input.sandboxFailureMessage !== null) {
    return input.sandboxFailureMessage;
  }

  return null;
}

function resolveSandboxFailureMessage(input: {
  failureMessage: string | null | undefined;
  fallbackMessage: string;
  status: string | undefined;
}): string | null {
  if (input.status !== "failed") {
    return null;
  }

  return input.failureMessage ?? input.fallbackMessage;
}

export function SandboxProfileSetupScriptTestButton(
  input: SetupScriptTestButtonProps,
): React.JSX.Element {
  const labels = input.labels ?? SetupScriptTestLabels;
  const canRun = input.canRun;
  const isBusy = input.status === "starting" || input.status === "running";
  const canStop = isBusy && input.onStop !== undefined;
  const isButtonDisabled =
    input.disabled === true || !canRun || input.status === "blank" || (isBusy && !canStop);
  const onButtonClick = canStop ? input.onStop : input.onRun;

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
      <ButtonGroup>
        <Button
          disabled={isButtonDisabled}
          onClick={onButtonClick}
          size="sm"
          title={resolveSetupScriptTestButtonTitle({
            canStop,
            canRun,
            disabled: input.disabled === true,
            labels,
            status: input.status,
          })}
          type="button"
          variant="outline"
        >
          {resolveSetupScriptTestButtonIcon({ canStop, status: input.status })}
          {resolveSetupScriptTestButtonLabel({ canStop, labels, status: input.status })}
        </Button>
        {input.setupAssistant === undefined ? null : input.setupAssistant.disabled ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex [&>[data-slot=button]]:rounded-l-none [&>[data-slot=button]]:border-l-0" />
              }
            >
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
  input: SetupScriptTestPanelProps,
): React.JSX.Element | null {
  if (input.status === "idle" || input.status === "blank") {
    return null;
  }

  const labels = input.labels ?? SetupScriptTestLabels;
  const isBusy = input.status === "starting" || input.status === "running";
  const isSuccess = input.status === "success";
  const isFailed = input.status === "failed";
  const renderOperationProgress = input.operationProgress !== undefined;

  return (
    <section className="mt-2 overflow-hidden rounded-md border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {isBusy ? (
            <SpinnerGapIcon aria-hidden className="size-4 animate-spin text-muted-foreground" />
          ) : isSuccess ? (
            <CheckCircleIcon
              aria-hidden
              className="size-4 text-emerald-600 dark:text-emerald-400"
              weight="fill"
            />
          ) : (
            <WarningCircleIcon aria-hidden className="size-4 text-destructive" weight="fill" />
          )}
          <span className="text-sm font-medium">
            {input.status === "starting"
              ? "Starting test sandbox"
              : input.status === "running"
                ? labels.runningLabel
                : input.status === "success"
                  ? labels.completedLabel
                  : labels.failedLabel}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {input.onClose === undefined ? null : (
            <Button
              aria-label={labels.closeOutputLabel}
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

      {renderOperationProgress ? (
        <div className="border-b border-border">{input.operationProgress}</div>
      ) : (
        <div className="p-3 text-sm text-muted-foreground">{labels.waitingMessage}</div>
      )}
    </section>
  );
}

function useSandboxProfileScriptTestRun(input: {
  canRun: boolean;
  disabled?: boolean;
  labels: ScriptTestLabels;
  script: string;
  startTestRun: (
    request: SetupScriptTestRunRequest & { idempotencyKey: string },
  ) => Promise<SandboxProfileSetupScriptTestRun | SandboxProfileMaintenanceScriptTestRun>;
  buildRuntimeConfig?: () => SandboxProfileSetupScriptTestRuntimeConfig;
}): SetupScriptTestRunState {
  const { buildRuntimeConfig, canRun, disabled, labels, script, startTestRun } = input;
  const [startedRun, setStartedRun] = useState<StartedSetupScriptTestRun | null>(null);
  const [runErrorMessage, setRunErrorMessage] = useState<string | null>(null);
  const [terminalResult, setTerminalResult] = useState<SetupScriptTestTerminalResult>(null);
  const stopRequestedSandboxInstanceIdsRef = useRef<ReadonlySet<string>>(new Set());
  const scriptIsBlank = script.trim().length === 0;
  const startedRunRef = useRef<StartedSetupScriptTestRun | null>(null);
  const clearStartedRun = useCallback((): void => {
    setStartedRun(null);
    startedRunRef.current = null;
    setTerminalResult(null);
  }, []);
  const stopTestSandboxBestEffort = useCallback(
    (run: StartedSetupScriptTestRun): void => {
      if (stopRequestedSandboxInstanceIdsRef.current.has(run.sandboxInstanceId)) {
        return;
      }

      stopRequestedSandboxInstanceIdsRef.current = new Set([
        ...stopRequestedSandboxInstanceIdsRef.current,
        run.sandboxInstanceId,
      ]);

      void stopSandboxInstance({
        instanceId: run.sandboxInstanceId,
        idempotencyKey: `${labels.stopIdempotencyPrefix}:${run.workflowRunId}`,
      }).catch(() => undefined);
    },
    [labels.stopIdempotencyPrefix],
  );
  const startMutation = useMutation({
    meta: NoLoadingIndicatorMeta,
    mutationFn: async (request: SetupScriptTestRunRequest) =>
      startTestRun({
        idempotencyKey: crypto.randomUUID(),
        ...request,
      }),
    onSuccess: (result, request) => {
      setRunErrorMessage(null);
      setTerminalResult(null);
      const nextStartedRun = {
        sandboxInstanceId: result.sandboxInstanceId,
        setupScript: request.script,
        workflowRunId: result.workflowRunId,
      };
      startedRunRef.current = nextStartedRun;
      setStartedRun(nextStartedRun);
    },
    onError: (error: unknown) => {
      setRunErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: labels.startErrorFallbackMessage,
        }),
      );
    },
  });
  const sandboxStatusQuery = useQuery({
    queryKey:
      startedRun === null
        ? ["sandbox-instance-status", labels.stopIdempotencyPrefix, null]
        : sandboxInstanceStatusQueryKey(startedRun.sandboxInstanceId),
    meta: NoLoadingIndicatorMeta,
    queryFn: async ({ signal }) => {
      if (startedRun === null) {
        throw new Error("Script test sandbox instance id is required.");
      }

      return getSandboxInstanceStatus({
        instanceId: startedRun.sandboxInstanceId,
        signal,
      });
    },
    enabled: startedRun !== null && terminalResult === null,
    refetchInterval: (query) =>
      query.state.error !== null ||
      query.state.data?.status === "running" ||
      query.state.data?.status === "failed" ||
      query.state.data?.status === "stopped"
        ? false
        : SetupScriptTestSandboxStatusRefetchIntervalMs,
    retry: false,
  });
  const sandboxFailureMessage = resolveSandboxFailureMessage({
    failureMessage: sandboxStatusQuery.data?.failureMessage,
    fallbackMessage: labels.failureFallbackMessage,
    status: sandboxStatusQuery.data?.status,
  });
  const sandboxStatusErrorMessage = sandboxStatusQuery.isError
    ? resolveApiErrorMessage({
        error: sandboxStatusQuery.error,
        fallbackMessage: labels.statusErrorFallbackMessage,
      })
    : null;
  const testRunErrorMessage = sandboxFailureMessage ?? sandboxStatusErrorMessage ?? runErrorMessage;
  const status = resolveSetupScriptTestStatus({
    runErrorMessage: testRunErrorMessage,
    sandboxStatus: sandboxStatusQuery.data?.status ?? null,
    scriptIsBlank,
    startIsPending: startMutation.isPending,
    startedRun,
    terminalResult,
  });
  const statusMessage = resolveSetupScriptTestStatusMessage({
    runErrorMessage: sandboxStatusErrorMessage ?? runErrorMessage,
    sandboxFailureMessage,
  });

  useEffect(() => {
    if (startedRun === null || sandboxStatusQuery.data?.status !== "running") {
      return;
    }

    setTerminalResult("success");
  }, [sandboxStatusQuery.data?.status, startedRun]);

  const startSetupScriptTest = useCallback((): void => {
    setRunErrorMessage(null);
    setTerminalResult(null);

    let runtimeConfig: SandboxProfileSetupScriptTestRuntimeConfig | undefined;
    try {
      runtimeConfig = buildRuntimeConfig?.();
    } catch (error: unknown) {
      setRunErrorMessage(
        error instanceof Error ? error.message : "Could not validate sandbox runtime settings.",
      );
      return;
    }

    clearStartedRun();
    startMutation.mutate({
      script,
      ...(runtimeConfig === undefined ? {} : { runtimeConfig }),
    });
  }, [buildRuntimeConfig, clearStartedRun, script, startMutation]);

  const handleRun = useCallback((): void => {
    if (
      !canRun ||
      disabled === true ||
      scriptIsBlank ||
      status === "starting" ||
      status === "running"
    ) {
      return;
    }

    startSetupScriptTest();
  }, [canRun, disabled, scriptIsBlank, startSetupScriptTest, status]);

  const handleStop = useCallback((): void => {
    const currentRun = startedRunRef.current;
    if (currentRun === null || (status !== "starting" && status !== "running")) {
      return;
    }

    setRunErrorMessage(null);
    clearStartedRun();
    stopTestSandboxBestEffort(currentRun);
  }, [clearStartedRun, status, stopTestSandboxBestEffort]);

  const handleClose = useCallback((): void => {
    setRunErrorMessage(null);
    clearStartedRun();
  }, [clearStartedRun]);

  return {
    buttonProps: {
      canRun,
      labels,
      onRun: handleRun,
      ...(startedRun === null ? {} : { onStop: handleStop }),
      status,
      ...(disabled === undefined ? {} : { disabled }),
    },
    panelProps: {
      labels,
      onClose: handleClose,
      operationProgress:
        startedRun === null ? undefined : (
          <SandboxOperationProgress
            emptyMessage={labels.waitingMessage}
            operationId={startedRun.workflowRunId}
            sandboxInstanceId={startedRun.sandboxInstanceId}
          />
        ),
      status,
      statusMessage,
    },
  };
}

export function useSandboxProfileSetupScriptTestRun(
  input: SetupScriptTestRunnerProps,
): SetupScriptTestRunState {
  const { buildRuntimeConfig, disabled, isDraft, profileId, setupScript, version } = input;
  return useSandboxProfileScriptTestRun({
    canRun: isDraft,
    labels: SetupScriptTestLabels,
    script: setupScript,
    startTestRun: async (request) =>
      startSandboxProfileSetupScriptTestRun({
        idempotencyKey: request.idempotencyKey,
        profileId,
        ...(request.runtimeConfig === undefined ? {} : { runtimeConfig: request.runtimeConfig }),
        setupScript: request.script,
        version,
      }),
    ...(buildRuntimeConfig === undefined ? {} : { buildRuntimeConfig }),
    ...(disabled === undefined ? {} : { disabled }),
  });
}

export function useSandboxProfileMaintenanceScriptTestRun(
  input: MaintenanceScriptTestRunnerProps,
): SetupScriptTestRunState {
  const { canRun, disabled, maintenanceScript, profileId, version } = input;
  return useSandboxProfileScriptTestRun({
    canRun,
    labels: MaintenanceScriptTestLabels,
    script: maintenanceScript,
    startTestRun: async (request) =>
      startSandboxProfileMaintenanceScriptTestRun({
        idempotencyKey: request.idempotencyKey,
        maintenanceScript: request.script,
        profileId,
        version,
      }),
    ...(disabled === undefined ? {} : { disabled }),
  });
}

export type { SetupScriptTestStatus };
