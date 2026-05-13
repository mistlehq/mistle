import {
  SandboxStorageBackend,
  SandboxStorageAttachLifecycles,
  type SandboxArchilStorageAttachment,
  type SandboxAttachStorageRequest,
  type SandboxCleanupStorageRequest,
} from "../../types.js";

const E2BArchilMountRoot = "/mnt/mistle/archil";
const SandboxdStorageAttachSignalPath = "/run/mistle/storage-attached";
const E2BArchilInitMarkerPath = `${E2BArchilMountRoot}/.mistle-init`;
const E2BArchilInitMarkerTempPath = `${E2BArchilInitMarkerPath}.tmp`;

function formatMountRootPath(sourcePath: string): string {
  return `${E2BArchilMountRoot}/${sourcePath}`;
}

function formatArchilBindMountSource(input: {
  storage: {
    handle: string;
    region: string;
  };
  sourcePath: string;
}): string {
  return `${input.storage.handle}[${input.storage.region}][/${input.sourcePath}]`;
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

function createBindMountDirectoriesCommand(input: {
  storage: {
    layout: {
      bindings: readonly {
        sourcePath: string;
        targetPath: string;
      }[];
    };
  };
}): string {
  const directories = input.storage.layout.bindings.flatMap((binding) => {
    if (binding.targetPath === "/root") {
      return [formatMountRootPath(binding.sourcePath)];
    }

    return [formatMountRootPath(binding.sourcePath), binding.targetPath];
  });
  return `mkdir -p ${directories.map((directory) => quoteShell(directory)).join(" ")}`;
}

function createHydrateBindingCommand(input: {
  storage: SandboxArchilStorageAttachment;
  sourcePath: string;
  source: string;
  target: string;
}): string {
  return [
    `if mountpoint -q ${quoteShell(input.target)}; then`,
    `  current_source="$(findmnt -n -o SOURCE --target ${quoteShell(input.target)} 2>/dev/null || true)"`,
    `  if [ "$current_source" != ${quoteShell(formatArchilBindMountSource({ storage: input.storage, sourcePath: input.sourcePath }))} ]; then`,
    `    echo "Refusing to hydrate Archil bind mount source from ${input.target}: target already mounted from unexpected source: $current_source" >&2`,
    "    exit 1",
    "  fi",
    `elif [ -e ${quoteShell(input.target)} ]; then`,
    `  mkdir -p ${quoteShell(input.source)}`,
    `  rsync -a --delete --exclude ${quoteShell(E2BArchilMountRoot)} ${quoteShell(`${input.target}/`)} ${quoteShell(`${input.source}/`)}`,
    "else",
    `  mkdir -p ${quoteShell(input.source)}`,
    "fi",
  ].join("\n");
}

function createHydrateStorageCommand(input: {
  lifecycle: SandboxAttachStorageRequest["lifecycle"];
  storage: SandboxArchilStorageAttachment;
}): string | null {
  if (input.lifecycle !== SandboxStorageAttachLifecycles.START) {
    return null;
  }

  const hydrateBindingCommands = input.storage.layout.bindings.map((binding) =>
    createHydrateBindingCommand({
      storage: input.storage,
      sourcePath: binding.sourcePath,
      source: formatMountRootPath(binding.sourcePath),
      target: binding.targetPath,
    }),
  );

  return [
    `if [ ! -e ${quoteShell(E2BArchilInitMarkerPath)} ]; then`,
    ...hydrateBindingCommands.map((command) =>
      command
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    ),
    `  : > ${quoteShell(E2BArchilInitMarkerTempPath)}`,
    `  mv ${quoteShell(E2BArchilInitMarkerTempPath)} ${quoteShell(E2BArchilInitMarkerPath)}`,
    "fi",
  ].join("\n");
}

function createEnsureBindMountCommand(input: {
  storage: SandboxArchilStorageAttachment;
  sourcePath: string;
  source: string;
  target: string;
}): string {
  return [
    `if mountpoint -q ${quoteShell(input.target)}; then`,
    `  current_source="$(findmnt -n -o SOURCE --target ${quoteShell(input.target)} 2>/dev/null || true)"`,
    `  if [ "$current_source" != ${quoteShell(formatArchilBindMountSource({ storage: input.storage, sourcePath: input.sourcePath }))} ]; then`,
    `    echo "Refusing to attach Archil bind mount onto ${input.target}: target already mounted from unexpected source: $current_source" >&2`,
    "    exit 1",
    "  fi",
    "else",
    `  mount --bind ${quoteShell(input.source)} ${quoteShell(input.target)}`,
    "fi",
  ].join("\n");
}

export function createE2BAttachStorageCommand(input: {
  lifecycle: SandboxAttachStorageRequest["lifecycle"];
  storage: SandboxArchilStorageAttachment;
}): string {
  if (input.storage.backend !== SandboxStorageBackend.ARCHIL) {
    throw new Error("Expected Archil storage attachment for E2B attach.");
  }

  const bindMountCommands = input.storage.layout.bindings.map((binding) =>
    createEnsureBindMountCommand({
      storage: input.storage,
      sourcePath: binding.sourcePath,
      source: formatMountRootPath(binding.sourcePath),
      target: binding.targetPath,
    }),
  );
  const hydrateStorageCommand = createHydrateStorageCommand({
    lifecycle: input.lifecycle,
    storage: input.storage,
  });

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
    [
      "  /opt/mistle/bin/archil mount",
      quoteShell(input.storage.handle),
      quoteShell(E2BArchilMountRoot),
      "--region",
      quoteShell(input.storage.region),
      ...(input.lifecycle === SandboxStorageAttachLifecycles.START ? ["--force"] : []),
    ].join(" "),
    "fi",
    ...(hydrateStorageCommand === null ? [] : [hydrateStorageCommand]),
    createBindMountDirectoriesCommand({
      storage: input.storage,
    }),
    ...bindMountCommands,
    "mkdir -p /run/mistle",
    `touch ${quoteShell(SandboxdStorageAttachSignalPath)}`,
  ].join("\n");
}

export function createE2BCleanupStorageCommand(input: {
  request: SandboxCleanupStorageRequest;
}): string | null {
  if (
    input.request.lifecycle === "stop" ||
    input.request.lifecycle === "destroy" ||
    input.request.timing === "after_compute_teardown"
  ) {
    return null;
  }

  if (input.request.storage.backend !== SandboxStorageBackend.ARCHIL) {
    throw new Error("Expected Archil storage attachment for E2B cleanup.");
  }
  return null;
}
