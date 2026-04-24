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
import { CpuIcon } from "@phosphor-icons/react";

import { OpenTargetRow } from "./open-target-row.js";
import {
  createProcessKey,
  createProcessLabel,
  resolvePrimaryProcessListener,
} from "./session-port-access-model.js";
import type { SessionPortAccessState } from "./use-session-port-access.js";

type ProcessListenerEntry = {
  listenerProcess: ProcessEntry;
  processLabel: string;
  bindAddresses: string[];
};

function createProcessListenerEntries(processes: ProcessEntry[]): ProcessListenerEntry[] {
  return processes
    .flatMap((process) => {
      const listenersByPort = new Map<number, ProcessEntry["listeners"]>();

      for (const listener of process.listeners) {
        const listenersForPort = listenersByPort.get(listener.port) ?? [];
        listenersForPort.push(listener);
        listenersByPort.set(listener.port, listenersForPort);
      }

      return [...listenersByPort.entries()].flatMap(([port, listeners]) => {
        const firstListener = listeners[0];
        if (firstListener === undefined) {
          return [];
        }

        return [
          {
            listenerProcess: {
              ...process,
              listeners: [
                {
                  bindAddress: firstListener.bindAddress,
                  port,
                },
              ],
            },
            processLabel: createProcessLabel(process),
            bindAddresses: listeners
              .map((listener) => listener.bindAddress)
              .sort((left, right) => {
                return left.localeCompare(right);
              }),
          },
        ];
      });
    })
    .sort((left, right) => {
      const leftListener = resolvePrimaryProcessListener(left.listenerProcess);
      const rightListener = resolvePrimaryProcessListener(right.listenerProcess);

      if (leftListener === null && rightListener === null) {
        return left.processLabel.localeCompare(right.processLabel);
      }
      if (leftListener === null) {
        return 1;
      }
      if (rightListener === null) {
        return -1;
      }

      return (
        leftListener.port - rightListener.port ||
        left.processLabel.localeCompare(right.processLabel)
      );
    });
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
  const listenerEntries = createProcessListenerEntries(input.state.processes);

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
            Select a process to open its HTTP port in a new tab.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto p-2">
          {input.state.errorMessage !== null ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {input.state.errorMessage}
            </p>
          ) : null}
          {input.state.isLoadingProcesses ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-stone-600">
              <Spinner className="size-4" />
              Loading running processes…
            </div>
          ) : null}
          {!input.state.isLoadingProcesses && listenerEntries.length === 0 ? (
            <p className="px-3 py-3 text-sm text-stone-600">
              No loopback-listening processes found.
            </p>
          ) : null}
          {listenerEntries.map((entry) => {
            const primaryListener = resolvePrimaryProcessListener(entry.listenerProcess);
            const isOpening =
              input.state.isOpeningProcessKey === createProcessKey(entry.listenerProcess);

            if (primaryListener === null) {
              return null;
            }

            return (
              <OpenTargetRow
                key={createProcessKey(entry.listenerProcess)}
                disabled={input.state.isOpeningProcessKey !== null}
                isLoading={isOpening}
                onClick={() => {
                  void input.state.openProcess(entry.listenerProcess);
                }}
                primary={
                  <p className="truncate">
                    {entry.bindAddresses.join(", ")}:
                    <span className="font-semibold text-stone-950">
                      {String(primaryListener.port)}
                    </span>
                  </p>
                }
                secondary={<p className="truncate text-xs text-stone-600">{entry.processLabel}</p>}
                title={createOpenLabel(entry.listenerProcess)}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
