import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SeaBundleFileNames, buildSeaBundles } from "./build-sea-bundles.mjs";

const ScriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const AppRootPath = resolve(ScriptDirectoryPath, "..");
const RepositoryRootPath = resolve(AppRootPath, "../..");
const SeaOutputDirectoryPath = resolve(AppRootPath, "dist-sea");
const SeaBundleDirectoryPath = resolve(SeaOutputDirectoryPath, "bundles");
const SeaBlobDirectoryPath = resolve(SeaOutputDirectoryPath, "blobs");
const NativeDistDirectoryPath = resolve(RepositoryRootPath, "packages/sandbox-rs-napi/dist");
const SeaSentinelFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const BootstrapBinaryName = "sandbox-bootstrap";
const RuntimeBinaryName = "sandboxd";

function runCommand(command, args, cwd = RepositoryRootPath) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
  });
}

function requireNode25() {
  const [majorVersionText] = process.versions.node.split(".");
  const majorVersion = Number.parseInt(majorVersionText ?? "", 10);
  if (!Number.isInteger(majorVersion) || majorVersion < 25) {
    throw new Error("SEA packaging requires Node.js 25 or newer.");
  }
}

function requireLinux() {
  if (process.platform !== "linux") {
    throw new Error("SEA packaging currently supports only Linux sandbox builds.");
  }
}

async function resolveNativeAddonPath() {
  const entries = await readdir(NativeDistDirectoryPath, {
    withFileTypes: true,
  });
  const nativeAddonEntries = entries.filter(
    (entry) => entry.isFile() && /^index\..+\.node$/u.test(entry.name),
  );

  if (nativeAddonEntries.length !== 1) {
    throw new Error(
      `Expected exactly one native addon in ${NativeDistDirectoryPath}, found ${String(nativeAddonEntries.length)}.`,
    );
  }

  const nativeAddonEntry = nativeAddonEntries[0];
  if (nativeAddonEntry === undefined) {
    throw new Error(`Expected a native addon entry in ${NativeDistDirectoryPath}.`);
  }

  return resolve(NativeDistDirectoryPath, nativeAddonEntry.name);
}

function createSeaConfig(input) {
  return {
    disableExperimentalSEAWarning: true,
    main: resolve(SeaBundleDirectoryPath, input.bundleFileName),
    output: resolve(SeaBlobDirectoryPath, input.blobFileName),
  };
}

async function writeSeaConfig(input) {
  const configPath = resolve(SeaBlobDirectoryPath, input.fileName);
  await writeFile(configPath, `${JSON.stringify(input.config, null, 2)}\n`, "utf8");
  return configPath;
}

async function prepareBinary(binaryPath) {
  await copyFile(process.execPath, binaryPath);
  await chmod(binaryPath, 0o755);
}

function injectSeaBlob(input) {
  const args = [
    "exec",
    "postject",
    input.binaryPath,
    "NODE_SEA_BLOB",
    input.blobPath,
    "--sentinel-fuse",
    SeaSentinelFuse,
  ];

  runCommand("pnpm", args, AppRootPath);
}

async function buildWorkspaceDependencies() {
  const buildTargets = [
    "@mistle/codex-app-server-client",
    "@mistle/integrations-core",
    "@mistle/integrations-definitions",
    "@mistle/sandbox-rs-napi",
    "@mistle/sandbox-session-client",
    "@mistle/sandbox-session-protocol",
    "@mistle/time",
  ];

  for (const target of buildTargets) {
    runCommand("pnpm", ["--filter", target, "build"]);
  }
}

async function main() {
  requireLinux();
  requireNode25();

  await rm(SeaOutputDirectoryPath, { force: true, recursive: true });
  await mkdir(SeaBlobDirectoryPath, { recursive: true });

  await buildWorkspaceDependencies();
  await buildSeaBundles(SeaBundleDirectoryPath);

  const bootstrapConfigPath = await writeSeaConfig({
    fileName: "bootstrap.sea.json",
    config: createSeaConfig({
      bundleFileName: SeaBundleFileNames.BOOTSTRAP,
      blobFileName: "sandbox-bootstrap.blob",
    }),
  });
  const runtimeConfigPath = await writeSeaConfig({
    fileName: "runtime.sea.json",
    config: createSeaConfig({
      bundleFileName: SeaBundleFileNames.RUNTIME,
      blobFileName: "sandboxd.blob",
    }),
  });

  runCommand(process.execPath, ["--experimental-sea-config", bootstrapConfigPath], AppRootPath);
  runCommand(process.execPath, ["--experimental-sea-config", runtimeConfigPath], AppRootPath);

  const bootstrapBinaryPath = resolve(SeaOutputDirectoryPath, BootstrapBinaryName);
  const runtimeBinaryPath = resolve(SeaOutputDirectoryPath, RuntimeBinaryName);

  await prepareBinary(bootstrapBinaryPath);
  await prepareBinary(runtimeBinaryPath);

  injectSeaBlob({
    binaryPath: bootstrapBinaryPath,
    blobPath: resolve(SeaBlobDirectoryPath, "sandbox-bootstrap.blob"),
  });
  injectSeaBlob({
    binaryPath: runtimeBinaryPath,
    blobPath: resolve(SeaBlobDirectoryPath, "sandboxd.blob"),
  });

  const nativeAddonPath = await resolveNativeAddonPath();
  await copyFile(nativeAddonPath, resolve(SeaOutputDirectoryPath, basename(nativeAddonPath)));
}

await main();
