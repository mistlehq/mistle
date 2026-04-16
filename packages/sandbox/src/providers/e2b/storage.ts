import {
  SandboxAttachedStorageBackends,
  type SandboxAttachedArchilStorage,
  type SandboxCleanupArchilStorage,
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

function formatArchilBindMountSource(input: {
  storage: {
    handle: string;
    region: string;
  };
  path: string;
}): string {
  return `${input.storage.handle}[${input.storage.region}][${input.path}]`;
}

function formatArchilMountRootSource(input: {
  storage: {
    handle: string;
    region: string;
  };
}): string {
  return `${input.storage.handle}[${input.storage.region}]`;
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function createMountRootDirectoryCommand(): string {
  return `mkdir -p ${quoteShell(E2BArchilMountRoot)}`;
}

function createBindMountDirectoriesCommand(): string {
  const directories = [
    `${E2BArchilMountRoot}/root`,
    `${E2BArchilMountRoot}/etc/codex`,
    `${E2BArchilMountRoot}/usr/local/bin`,
    "/etc/codex",
    "/usr/local/bin",
  ];
  return `mkdir -p ${directories.map((directory) => quoteShell(directory)).join(" ")}`;
}

function createEnsureBindMountCommand(input: {
  storage: SandboxAttachedArchilStorage;
  path: string;
  source: string;
  target: string;
}): string {
  return [
    `if mountpoint -q ${quoteShell(input.target)}; then`,
    `  current_source="$(findmnt -n -o SOURCE --target ${quoteShell(input.target)} 2>/dev/null || true)"`,
    `  if [ "$current_source" != ${quoteShell(formatArchilBindMountSource({ storage: input.storage, path: input.path }))} ]; then`,
    `    echo "Refusing to attach Archil bind mount onto ${input.target}: target already mounted from unexpected source: $current_source" >&2`,
    "    exit 1",
    "  fi",
    "else",
    `  mount --bind ${quoteShell(input.source)} ${quoteShell(input.target)}`,
    "fi",
  ].join("\n");
}

function createCleanupBindMountCommand(input: {
  storage: SandboxCleanupArchilStorage;
  path: string;
  target: string;
}): string {
  return [
    `current_source="$(findmnt -n -o SOURCE --target ${quoteShell(input.target)} 2>/dev/null || true)"`,
    `if [ "$current_source" = ${quoteShell(formatArchilBindMountSource({ storage: input.storage, path: input.path }))} ]; then`,
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
      storage: input.storage,
      path: mount.source.slice(E2BArchilMountRoot.length),
      source: mount.source,
      target: mount.target,
    }),
  );

  return [
    "set -eu",
    createMountRootDirectoryCommand(),
    `if mountpoint -q ${quoteShell(E2BArchilMountRoot)}; then`,
    `  current_source="$(findmnt -n -o SOURCE --target ${quoteShell(E2BArchilMountRoot)} 2>/dev/null || true)"`,
    `  if [ "$current_source" != ${quoteShell(formatArchilMountRootSource({ storage: input.storage }))} ]; then`,
    `    echo "Refusing to attach Archil mount root onto ${E2BArchilMountRoot}: target already mounted from unexpected source: $current_source" >&2`,
    "    exit 1",
    "  fi",
    "else",
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

  if (input.request.storage.backend !== SandboxAttachedStorageBackends.ARCHIL) {
    throw new Error("Expected Archil storage attachment for E2B cleanup.");
  }

  const cleanupBindMountCommands = [...E2BDurableBindMounts].reverse().map((mount) =>
    createCleanupBindMountCommand({
      storage: input.request.storage,
      path: mount.source.slice(E2BArchilMountRoot.length),
      target: mount.target,
    }),
  );

  return [
    "set -eu",
    "cd /",
    ...cleanupBindMountCommands,
    `if mountpoint -q ${quoteShell(E2BArchilMountRoot)}; then`,
    `  current_source="$(findmnt -n -o SOURCE --target ${quoteShell(E2BArchilMountRoot)} 2>/dev/null || true)"`,
    `  if [ "$current_source" = ${quoteShell(formatArchilMountRootSource({ storage: input.request.storage }))} ]; then`,
    `    /opt/mistle/bin/archil unmount ${quoteShell(E2BArchilMountRoot)}`,
    "  fi",
    "fi",
  ].join("\n");
}
