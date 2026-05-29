import type { ProcessEntry } from "@mistle/sandbox-session-protocol";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
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

const MistleManagedProcessCommandPrefixes = [
  // Pi is intentionally covered by sandboxd: its managed websocket listener is owned by
  // /opt/mistle/bin/sandboxd, while the Pi child runs over stdio from
  // /var/lib/mistle/artifacts/pi-cli/pi and does not own the port row.
  "/opt/mistle/bin/sandboxd",
  "/usr/local/bin/codex ",
  "/usr/local/bin/opencode ",
];

function shouldShowBindAddressInDashboard(bindAddress: string): boolean {
  // Product decision: the dashboard process menu is for common browser-facing dev servers.
  // Include IPv4 and IPv6 loopback/all-interface binds because common tools can report
  // localhost listeners as IPv6 wildcard sockets while still serving local browser traffic.
  return (
    bindAddress === "127.0.0.1" ||
    bindAddress === "0.0.0.0" ||
    bindAddress === "::1" ||
    bindAddress === "::" ||
    bindAddress === "localhost"
  );
}

function shouldShowProcessInDashboard(process: ProcessEntry): boolean {
  const command = process.command?.trim();
  if (command === undefined || command.length === 0) {
    return true;
  }

  // Product decision: Mistle-managed daemon and agent runtime ports are internal plumbing.
  // Keep them available to sandboxd authorization, but do not advertise them as user app ports.
  return !MistleManagedProcessCommandPrefixes.some((prefix) => command.startsWith(prefix));
}

function createDisplayProcessLabel(label: string): string {
  const [commandPath, ...args] = label.trim().split(/\s+/);
  if (commandPath === undefined) {
    return label;
  }

  const commandName = commandPath.split("/").filter(Boolean).at(-1) ?? commandPath;
  return [commandName, ...args].join(" ");
}

function createDisplayBindAddress(bindAddress: string): string {
  if (bindAddress.includes(":")) {
    return `[${bindAddress}]`;
  }

  return bindAddress;
}

function createProcessListenerEntries(processes: ProcessEntry[]): ProcessListenerEntry[] {
  const listenersByPort = new Map<number, ProcessListenerEntry>();

  for (const process of processes) {
    if (!shouldShowProcessInDashboard(process)) {
      continue;
    }

    for (const listener of process.listeners) {
      if (!shouldShowBindAddressInDashboard(listener.bindAddress)) {
        continue;
      }

      const existingEntry = listenersByPort.get(listener.port);
      if (existingEntry !== undefined) {
        if (!existingEntry.bindAddresses.includes(listener.bindAddress)) {
          existingEntry.bindAddresses.push(listener.bindAddress);
          existingEntry.bindAddresses.sort((left, right) => {
            return left.localeCompare(right);
          });
        }
        continue;
      }

      listenersByPort.set(listener.port, {
        listenerProcess: {
          ...process,
          listeners: [listener],
        },
        processLabel: createProcessLabel(process),
        bindAddresses: [listener.bindAddress],
      });
    }
  }

  return [...listenersByPort.values()].sort((left, right) => {
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
      leftListener.port - rightListener.port || left.processLabel.localeCompare(right.processLabel)
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
  const buttonClassName = input.state.isPanelOpen
    ? "bg-muted text-foreground shadow-none hover:bg-muted/80"
    : "bg-transparent text-foreground shadow-none hover:bg-muted/60";

  return (
    <Popover onOpenChange={input.state.setPanelOpen} open={input.state.isPanelOpen}>
      <PopoverTrigger
        render={
          <Button
            aria-label="Open processes"
            aria-pressed={input.state.isPanelOpen}
            className={buttonClassName}
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
      <PopoverContent
        align="end"
        className="max-h-[calc(100dvh-5rem)] w-96 gap-0 overflow-hidden p-0"
      >
        <PopoverHeader className="border-b px-4 py-3">
          <PopoverTitle>Local Ports</PopoverTitle>
          <PopoverDescription>
            Processes listening on local loopback or all-interface addresses.
          </PopoverDescription>
        </PopoverHeader>
        <ProcessAccessList listenerEntries={listenerEntries} state={input.state} />
      </PopoverContent>
    </Popover>
  );
}

export function SessionPortAccessSheet(input: {
  state: SessionPortAccessState;
}): React.JSX.Element {
  const listenerEntries = createProcessListenerEntries(input.state.processes);

  return (
    <Sheet onOpenChange={input.state.setPanelOpen} open={input.state.isPanelOpen}>
      <SheetContent className="!h-[100dvh] max-h-[100dvh] gap-0 p-0" side="bottom">
        <SheetHeader className="shrink-0 border-b px-4 py-3 pr-12 text-left">
          <SheetTitle>Local Ports</SheetTitle>
          <SheetDescription>
            Processes listening on local loopback or all-interface addresses.
          </SheetDescription>
        </SheetHeader>
        <ProcessAccessList listenerEntries={listenerEntries} state={input.state} />
      </SheetContent>
    </Sheet>
  );
}

function ProcessAccessList(input: {
  listenerEntries: ProcessListenerEntry[];
  state: SessionPortAccessState;
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
      {input.state.errorMessage !== null ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {input.state.errorMessage}
        </p>
      ) : null}
      {input.state.isLoadingProcesses ? (
        <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading running processes…
        </div>
      ) : null}
      {!input.state.isLoadingProcesses && input.listenerEntries.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          No local listening processes found.
        </p>
      ) : null}
      {input.listenerEntries.map((entry) => {
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
                {entry.bindAddresses.map(createDisplayBindAddress).join(", ")}:
                <span className="font-semibold text-foreground">
                  {String(primaryListener.port)}
                </span>
              </p>
            }
            secondary={
              <p className="truncate text-xs text-muted-foreground">
                {createDisplayProcessLabel(entry.processLabel)}
              </p>
            }
            title={createOpenLabel(entry.listenerProcess)}
          />
        );
      })}
    </div>
  );
}
