import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DiscoveredLiveListener = {
  bindAddress: string;
  command?: string;
  pid?: number;
  port: number;
};

type ParsedSocketAddress = {
  bindAddress: string;
  port: number;
};

function isLoopbackAddress(bindAddress: string): boolean {
  return bindAddress === "::1" || bindAddress.startsWith("127.");
}

function parsePort(rawPort: string): number | undefined {
  if (!/^[0-9]+$/u.test(rawPort)) {
    return undefined;
  }

  const parsedPort = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    return undefined;
  }

  return parsedPort;
}

function parsePositiveInteger(rawValue: string): number | undefined {
  if (!/^[0-9]+$/u.test(rawValue)) {
    return undefined;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    return undefined;
  }

  return parsedValue;
}

function parseSocketAddress(rawAddress: string): ParsedSocketAddress | undefined {
  const trimmedAddress = rawAddress.trim();
  const ipv6Match = /^\[(?<host>[^\]]+)\]:(?<port>[0-9]+)$/u.exec(trimmedAddress);
  if (ipv6Match?.groups !== undefined) {
    const host = ipv6Match.groups.host;
    const port = ipv6Match.groups.port;
    if (host === undefined || port === undefined) {
      return undefined;
    }

    const parsedPort = parsePort(port);
    if (parsedPort === undefined || !isLoopbackAddress(host)) {
      return undefined;
    }

    return {
      bindAddress: host,
      port: parsedPort,
    };
  }

  const separatorIndex = trimmedAddress.lastIndexOf(":");
  if (separatorIndex < 1 || separatorIndex === trimmedAddress.length - 1) {
    return undefined;
  }

  const bindAddress = trimmedAddress.slice(0, separatorIndex);
  const parsedPort = parsePort(trimmedAddress.slice(separatorIndex + 1));
  if (parsedPort === undefined || !isLoopbackAddress(bindAddress)) {
    return undefined;
  }

  return {
    bindAddress,
    port: parsedPort,
  };
}

export function parseLsofListeningSockets(stdout: string): DiscoveredLiveListener[] {
  const listenersByKey = new Map<string, DiscoveredLiveListener>();
  let currentPid: number | undefined;
  let currentCommand: string | undefined;

  for (const rawLine of stdout.split("\n")) {
    if (rawLine.length < 2) {
      continue;
    }

    const fieldType = rawLine[0];
    const fieldValue = rawLine.slice(1);

    if (fieldType === "p") {
      currentPid = parsePositiveInteger(fieldValue);
      currentCommand = undefined;
      continue;
    }

    if (fieldType === "c") {
      currentCommand = fieldValue.trim().length === 0 ? undefined : fieldValue.trim();
      continue;
    }

    if (fieldType !== "n") {
      continue;
    }

    const parsedSocketAddress = parseSocketAddress(fieldValue);
    if (parsedSocketAddress === undefined) {
      continue;
    }

    const dedupeKey = `${parsedSocketAddress.bindAddress}:${String(parsedSocketAddress.port)}`;
    if (listenersByKey.has(dedupeKey)) {
      continue;
    }

    listenersByKey.set(dedupeKey, {
      bindAddress: parsedSocketAddress.bindAddress,
      ...(currentCommand === undefined ? {} : { command: currentCommand }),
      ...(currentPid === undefined ? {} : { pid: currentPid }),
      port: parsedSocketAddress.port,
    });
  }

  return Array.from(listenersByKey.values()).sort((left, right) => {
    if (left.port !== right.port) {
      return left.port - right.port;
    }

    return left.bindAddress.localeCompare(right.bindAddress);
  });
}

export async function discoverLiveListeners(): Promise<DiscoveredLiveListener[]> {
  const { stdout } = await execFileAsync("lsof", [
    "-nP",
    "+c",
    "0",
    "-iTCP",
    "-sTCP:LISTEN",
    "-Fpcn",
  ]);

  return parseLsofListeningSockets(stdout);
}
