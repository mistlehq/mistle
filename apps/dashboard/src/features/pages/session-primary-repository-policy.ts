import { DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";

import type { SessionWorkbenchHeaderRepositoryOption } from "./session-workbench-header-actions.js";

type SessionPrimaryRepositorySelection =
  | { kind: "none" }
  | { kind: "available"; path: string }
  | { kind: "unavailable"; path: string; option: SessionWorkbenchHeaderRepositoryOption };

function normalizeRepositoryPath(path: string): string {
  return path.replace(/\/+$/, "");
}

export function buildRepositoryDiscoveryFindArgs(input: { workspaceRoot: string }): string[] {
  return [
    input.workspaceRoot,
    "-mindepth",
    "1",
    "-maxdepth",
    "3",
    "(",
    "-type",
    "d",
    "-o",
    "-type",
    "f",
    ")",
    "-name",
    ".git",
  ];
}

export function parseRepositoryPaths(input: { findOutput: string }): string[] {
  const parsedPaths = input.findOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.endsWith("/.git"))
    .map((line) => normalizeRepositoryPath(line.slice(0, -"/.git".length)));

  return [...new Set(parsedPaths)].sort((left, right) => left.localeCompare(right));
}

export function toRepositoryOptions(input: {
  repositoryPaths: readonly string[];
  workspaceRoot: string;
}): ReadonlyArray<SessionWorkbenchHeaderRepositoryOption> {
  return input.repositoryPaths.map((path) => ({
    value: path,
    label:
      path.startsWith(`${input.workspaceRoot}/`) && path.length > input.workspaceRoot.length + 1
        ? path.slice(input.workspaceRoot.length + 1)
        : path,
  }));
}

function toUnavailableSelectedOption(input: {
  selectedRepositoryPath: string;
  workspaceRoot: string;
}): SessionWorkbenchHeaderRepositoryOption {
  const label =
    input.selectedRepositoryPath.startsWith(`${input.workspaceRoot}/`) &&
    input.selectedRepositoryPath.length > input.workspaceRoot.length + 1
      ? input.selectedRepositoryPath.slice(input.workspaceRoot.length + 1)
      : input.selectedRepositoryPath;

  return {
    value: input.selectedRepositoryPath,
    label: `${label} (unavailable)`,
  };
}

function hasContainingRepositoryOption(input: {
  repositoryOptions: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
  selectedRepositoryPath: string;
}): boolean {
  return input.repositoryOptions.some(
    (option) =>
      input.selectedRepositoryPath.startsWith(`${option.value}/`) &&
      input.selectedRepositoryPath.length > option.value.length + 1,
  );
}

function resolvePrimaryRepositorySelection(input: {
  repositoryOptions: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
  selectedRepositoryPath: string | null;
  workspaceRoot?: string;
}): SessionPrimaryRepositorySelection {
  if (input.selectedRepositoryPath === null) {
    return { kind: "none" };
  }

  const availableOption = input.repositoryOptions.find(
    (option) => option.value === input.selectedRepositoryPath,
  );
  if (availableOption !== undefined) {
    return {
      kind: "available",
      path: input.selectedRepositoryPath,
    };
  }

  return {
    kind: "unavailable",
    path: input.selectedRepositoryPath,
    option: toUnavailableSelectedOption({
      selectedRepositoryPath: input.selectedRepositoryPath,
      workspaceRoot: input.workspaceRoot ?? DefaultSandboxWorkspaceDir,
    }),
  };
}

function resolveUnavailableRepositoryErrorMessage(input: {
  repositoryOptions: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
  selectedRepositoryPath: string;
}): string {
  const hasContainingRepository = hasContainingRepositoryOption({
    repositoryOptions: input.repositoryOptions,
    selectedRepositoryPath: input.selectedRepositoryPath,
  });
  if (hasContainingRepository) {
    return `Codex is running in ${input.selectedRepositoryPath}, which is not a selectable repository root.`;
  }

  return "The selected repository is no longer available in this sandbox.";
}

export function resolvePrimaryRepositoryTurnStartCwd(
  selectedRepositoryPath: string | null,
): string {
  return selectedRepositoryPath ?? DefaultSandboxWorkspaceDir;
}

export function resolveSessionWorkbenchCwd(input: {
  activeThreadCwd: string | null | undefined;
  selectedRepositoryPath: string | null;
}): string {
  return input.selectedRepositoryPath ?? input.activeThreadCwd ?? DefaultSandboxWorkspaceDir;
}

function resolveSelectedRepositoryPathFromCwd(input: {
  cwd: string;
  workspaceRoot?: string;
}): string | null {
  return input.cwd === (input.workspaceRoot ?? DefaultSandboxWorkspaceDir) ? null : input.cwd;
}

export function resolveInitialSelectedRepositoryPath(input: {
  activeThreadCwd: string | undefined;
  runtimePrimaryRepositoryRoot: string | null | undefined;
  workspaceRoot?: string;
}): string | null {
  if (input.activeThreadCwd !== undefined) {
    return resolveSelectedRepositoryPathFromCwd({
      cwd: input.activeThreadCwd,
      ...(input.workspaceRoot === undefined ? {} : { workspaceRoot: input.workspaceRoot }),
    });
  }

  return input.runtimePrimaryRepositoryRoot ?? null;
}

export function resolvePrimaryRepositoryPresentation(input: {
  repositoryOptions: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
  selectedRepositoryPath: string | null;
  queryState: "idle" | "loaded" | "error";
  queryErrorMessage: string | null;
  workspaceRoot?: string;
}): {
  errorMessage: string | null;
  options: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
} {
  const selection =
    input.queryState === "loaded" || input.queryState === "error"
      ? resolvePrimaryRepositorySelection({
          repositoryOptions: input.repositoryOptions,
          selectedRepositoryPath: input.selectedRepositoryPath,
          ...(input.workspaceRoot === undefined ? {} : { workspaceRoot: input.workspaceRoot }),
        })
      : input.selectedRepositoryPath === null
        ? { kind: "none" as const }
        : { kind: "available" as const, path: input.selectedRepositoryPath };

  return {
    errorMessage:
      input.queryErrorMessage ??
      (selection.kind === "unavailable"
        ? resolveUnavailableRepositoryErrorMessage({
            repositoryOptions: input.repositoryOptions,
            selectedRepositoryPath: selection.path,
          })
        : null),
    options: [
      ...(selection.kind === "unavailable" ? [selection.option] : []),
      ...input.repositoryOptions,
    ],
  };
}
