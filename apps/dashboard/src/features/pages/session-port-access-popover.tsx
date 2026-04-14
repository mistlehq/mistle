import type { ProcessEntry } from "@mistle/sandbox-session-protocol";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Spinner,
} from "@mistle/ui";
import { ArrowSquareOutIcon, CpuIcon } from "@phosphor-icons/react";

import {
  createProcessKey,
  createProcessLabel,
  resolvePrimaryProcessListener,
} from "./session-port-access-model.js";
import type { SessionPortAccessState } from "./use-session-port-access.js";

function resolvePrimaryProcessPort(process: ProcessEntry): number {
  return resolvePrimaryProcessListener(process)?.port ?? Number.POSITIVE_INFINITY;
}

function createListenersLabel(process: ProcessEntry): string {
  if (process.listeners.length === 0) {
    return "No loopback listeners";
  }

  return process.listeners
    .map((listener) => `${listener.bindAddress}:${String(listener.port)}`)
    .join(", ");
}

function createOpenLabel(process: ProcessEntry): string {
  const primaryListener = resolvePrimaryProcessListener(process);
  if (primaryListener === null) {
    return "No open port available";
  }

  return `Open port ${String(primaryListener.port)}`;
}

export function SessionPortAccessPopover(input: {
  state: SessionPortAccessState;
}): React.JSX.Element {
  const isButtonDisabled = input.state.buttonDisabledReason !== null;
  const sortedProcesses = [...input.state.processes].sort((left, right) => {
    return resolvePrimaryProcessPort(left) - resolvePrimaryProcessPort(right);
  });

  return (
    <Popover onOpenChange={input.state.setPanelOpen} open={input.state.isPanelOpen}>
      <PopoverTrigger
        render={
          <Button
            aria-label="Open processes"
            aria-pressed={input.state.isPanelOpen}
            className={
              input.state.isPanelOpen
                ? "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300"
                : "bg-transparent text-foreground shadow-none hover:bg-stone-100"
            }
            disabled={isButtonDisabled}
            size="icon-sm"
            title={input.state.buttonDisabledReason ?? "Show running processes"}
            type="button"
            variant="ghost"
          />
        }
      >
        <CpuIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-0 p-0">
        <PopoverHeader className="border-b border-stone-200 px-4 py-3">
          <PopoverTitle>Processes</PopoverTitle>
          <PopoverDescription>
            Select a process to open its primary HTTP port in a new tab.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto p-2">
          {input.state.errorMessage !== null ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {input.state.errorMessage}
            </p>
          ) : null}
          {input.state.isLoadingProcesses ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-stone-600">
              <Spinner className="size-4" />
              Loading running processes…
            </div>
          ) : null}
          {!input.state.isLoadingProcesses && input.state.processes.length === 0 ? (
            <p className="px-3 py-6 text-sm text-stone-600">
              No loopback-listening processes found.
            </p>
          ) : null}
          {sortedProcesses.map((process) => {
            const primaryListener = resolvePrimaryProcessListener(process);
            const isOpening = input.state.isOpeningProcessKey === createProcessKey(process);

            return (
              <button
                key={createProcessKey(process)}
                className="group/process-row flex w-full flex-col gap-1 rounded-md px-3 py-3 text-left hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={primaryListener === null || input.state.isOpeningProcessKey !== null}
                onClick={() => {
                  void input.state.openProcess(process);
                }}
                title={createOpenLabel(process)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <p className="truncate text-sm font-medium text-stone-950 group-hover/process-row:underline group-focus-visible/process-row:underline">
                      {createProcessLabel(process)}
                    </p>
                    <ArrowSquareOutIcon
                      aria-hidden
                      className="size-4 shrink-0 opacity-0 transition-[opacity,transform] group-hover/process-row:translate-x-0.5 group-hover/process-row:opacity-100 group-focus-visible/process-row:translate-x-0.5 group-focus-visible/process-row:opacity-100"
                    />
                  </div>
                  {isOpening ? <Spinner aria-hidden className="size-4 text-stone-500" /> : null}
                </div>
                <p className="text-xs text-stone-600">{createListenersLabel(process)}</p>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
