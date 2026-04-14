import { DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";

import type { SessionWorkbenchHeaderRepositoryOption } from "./session-workbench-header-actions.js";

export type SessionPrimaryRepositorySelection =
  | { kind: "none" }
  | { kind: "available"; path: string }
  | { kind: "unavailable"; path: string; option: SessionWorkbenchHeaderRepositoryOption };

export function normalizeRepositoryPath(path: string): string {
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

export function resolvePrimaryRepositorySelection(input: {
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

export function resolvePrimaryRepositoryPresentation(input: {
  repositoryOptions: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
  selectedRepositoryPath: string | null;
  queryState: "idle" | "loaded" | "error";
  queryErrorMessage: string | null;
  workspaceRoot?: string;
}): {
  errorMessage: string | null;
  options: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
  selection: SessionPrimaryRepositorySelection;
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
        ? "The selected repository is no longer available in this sandbox."
        : null),
    options: [
      ...(selection.kind === "unavailable" ? [selection.option] : []),
      ...input.repositoryOptions,
    ],
    selection,
  };
}

export { DefaultSandboxWorkspaceDir };
