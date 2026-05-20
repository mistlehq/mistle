import { useSyncExternalStore } from "react";

import { getDashboardConfig } from "../../config.js";
import { getDashboardCapabilitiesReleaseVersion } from "./dashboard-capabilities-service.js";

export type DashboardBuildDriftStatus =
  | {
      kind: "unknown";
      clientReleaseVersion: string;
    }
  | {
      kind: "current";
      clientReleaseVersion: string;
      serverReleaseVersion: string;
    }
  | {
      kind: "drift";
      clientReleaseVersion: string;
      serverReleaseVersion: string | null;
    };

type DashboardBuildDriftListener = () => void;
type DashboardBuildDriftSchemaMismatchPromptListener = () => void;

const DashboardBuildDriftListeners = new Set<DashboardBuildDriftListener>();
const DashboardBuildDriftSchemaMismatchPromptListeners =
  new Set<DashboardBuildDriftSchemaMismatchPromptListener>();

function createUnknownStatus(): DashboardBuildDriftStatus {
  return {
    kind: "unknown",
    clientReleaseVersion: getDashboardConfig().releaseVersion,
  };
}

let currentStatus: DashboardBuildDriftStatus | null = null;
let currentSchemaMismatchPromptRevision = 0;

function emitDashboardBuildDriftChange(): void {
  for (const listener of DashboardBuildDriftListeners) {
    listener();
  }
}

function emitDashboardBuildDriftSchemaMismatchPromptChange(): void {
  for (const listener of DashboardBuildDriftSchemaMismatchPromptListeners) {
    listener();
  }
}

function setDashboardBuildDriftStatus(nextStatus: DashboardBuildDriftStatus): void {
  const previousStatus = currentStatus;
  const changed =
    previousStatus === null ||
    previousStatus.kind !== nextStatus.kind ||
    previousStatus.clientReleaseVersion !== nextStatus.clientReleaseVersion ||
    ("serverReleaseVersion" in previousStatus ? previousStatus.serverReleaseVersion : null) !==
      ("serverReleaseVersion" in nextStatus ? nextStatus.serverReleaseVersion : null);

  currentStatus = nextStatus;

  if (changed) {
    emitDashboardBuildDriftChange();
  }
}

export function subscribeDashboardBuildDrift(listener: DashboardBuildDriftListener): () => void {
  DashboardBuildDriftListeners.add(listener);

  return () => {
    DashboardBuildDriftListeners.delete(listener);
  };
}

export function subscribeDashboardBuildDriftSchemaMismatchPrompt(
  listener: DashboardBuildDriftSchemaMismatchPromptListener,
): () => void {
  DashboardBuildDriftSchemaMismatchPromptListeners.add(listener);

  return () => {
    DashboardBuildDriftSchemaMismatchPromptListeners.delete(listener);
  };
}

export function getDashboardBuildDriftStatus(): DashboardBuildDriftStatus {
  return currentStatus ?? createUnknownStatus();
}

export function getDashboardBuildDriftSchemaMismatchPromptRevision(): number {
  return currentSchemaMismatchPromptRevision;
}

export function useDashboardBuildDriftStatus(): DashboardBuildDriftStatus {
  return useSyncExternalStore(
    subscribeDashboardBuildDrift,
    getDashboardBuildDriftStatus,
    getDashboardBuildDriftStatus,
  );
}

export function useDashboardBuildDriftSchemaMismatchPromptRevision(): number {
  return useSyncExternalStore(
    subscribeDashboardBuildDriftSchemaMismatchPrompt,
    getDashboardBuildDriftSchemaMismatchPromptRevision,
    getDashboardBuildDriftSchemaMismatchPromptRevision,
  );
}

export function resolveDashboardBuildDriftStatus(input: {
  clientReleaseVersion: string;
  serverReleaseVersion: string | null;
}): DashboardBuildDriftStatus {
  return input.serverReleaseVersion !== null &&
    input.clientReleaseVersion === input.serverReleaseVersion
    ? {
        kind: "current",
        clientReleaseVersion: input.clientReleaseVersion,
        serverReleaseVersion: input.serverReleaseVersion,
      }
    : {
        kind: "drift",
        clientReleaseVersion: input.clientReleaseVersion,
        serverReleaseVersion: input.serverReleaseVersion,
      };
}

export async function checkDashboardBuildDrift(input?: {
  signal?: AbortSignal;
}): Promise<DashboardBuildDriftStatus> {
  const clientReleaseVersion = getDashboardConfig().releaseVersion;
  const serverReleaseVersion = await getDashboardCapabilitiesReleaseVersion(
    input?.signal === undefined ? undefined : { signal: input.signal },
  );
  const nextStatus = resolveDashboardBuildDriftStatus({
    clientReleaseVersion,
    serverReleaseVersion,
  });

  setDashboardBuildDriftStatus(nextStatus);
  return nextStatus;
}

export function requestDashboardBuildDriftSchemaMismatchPrompt(): void {
  currentSchemaMismatchPromptRevision += 1;
  emitDashboardBuildDriftSchemaMismatchPromptChange();
}

export function resetDashboardBuildDriftForTest(): void {
  currentStatus = null;
  currentSchemaMismatchPromptRevision = 0;
  emitDashboardBuildDriftChange();
  emitDashboardBuildDriftSchemaMismatchPromptChange();
}

export function reloadDashboardForCurrentRelease(): void {
  globalThis.location.reload();
}
