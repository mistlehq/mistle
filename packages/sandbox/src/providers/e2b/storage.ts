import {
  SandboxAttachedStorageBackends,
  type SandboxAttachedArchilStorage,
  type SandboxCleanupStorageRequest,
} from "../../types.js";

const E2BArchilMountRoot = "/mnt/mistle/archil";

const E2BDurableBindMounts = [
  {
    source: `${E2BArchilMountRoot}/root`,
    target: "/root",
  },
  {
    source: `${E2BArchilMountRoot}/etc/codex`,
    target: "/etc/codex",
  },
  {
    source: `${E2BArchilMountRoot}/usr/local/bin`,
    target: "/usr/local/bin",
  },
] as const;

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function createBindMountDirectoriesCommand(): string {
  const directories = [
    E2BArchilMountRoot,
    `${E2BArchilMountRoot}/root`,
    `${E2BArchilMountRoot}/etc/codex`,
    `${E2BArchilMountRoot}/usr/local/bin`,
    "/etc/codex",
    "/usr/local/bin",
  ];

  return `mkdir -p ${directories.map((directory) => quoteShell(directory)).join(" ")}`;
}

function createEnsureBindMountCommand(input: { source: string; target: string }): string {
  return [
    `current_source="$(findmnt -n -o SOURCE --target ${quoteShell(input.target)} 2>/dev/null || true)"`,
    `if [ "$current_source" != ${quoteShell(input.source)} ]; then`,
    `  mount --bind ${quoteShell(input.source)} ${quoteShell(input.target)}`,
    "fi",
  ].join("\n");
}

function createCleanupBindMountCommand(input: { source: string; target: string }): string {
  return [
    `current_source="$(findmnt -n -o SOURCE --target ${quoteShell(input.target)} 2>/dev/null || true)"`,
    `if [ "$current_source" = ${quoteShell(input.source)} ]; then`,
    `  umount ${quoteShell(input.target)}`,
    "fi",
  ].join("\n");
}

export function createE2BAttachStorageCommand(input: {
  storage: SandboxAttachedArchilStorage;
}): string {
  if (input.storage.backend !== SandboxAttachedStorageBackends.ARCHIL) {
    throw new Error("Expected Archil storage attachment for E2B attach.");
  }

  const bindMountCommands = E2BDurableBindMounts.map((mount) =>
    createEnsureBindMountCommand({
      source: mount.source,
      target: mount.target,
    }),
  );

  return [
    "set -eu",
    createBindMountDirectoriesCommand(),
    `if ! mountpoint -q ${quoteShell(E2BArchilMountRoot)}; then`,
    `  /opt/mistle/bin/archil mount ${quoteShell(input.storage.handle)} ${quoteShell(E2BArchilMountRoot)} --region ${quoteShell(input.storage.region)}`,
    "fi",
    createBindMountDirectoriesCommand(),
    ...bindMountCommands,
  ].join("\n");
}

export function createE2BCleanupStorageCommand(input: {
  request: SandboxCleanupStorageRequest;
}): string | null {
  if (input.request.timing === "after_compute_teardown") {
    return null;
  }

  const cleanupBindMountCommands = [...E2BDurableBindMounts].reverse().map((mount) =>
    createCleanupBindMountCommand({
      source: mount.source,
      target: mount.target,
    }),
  );

  return [
    "set -eu",
    ...cleanupBindMountCommands,
    `if mountpoint -q ${quoteShell(E2BArchilMountRoot)}; then`,
    `  /opt/mistle/bin/archil unmount ${quoteShell(E2BArchilMountRoot)}`,
    "fi",
  ].join("\n");
}
