import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const nativePackageRootPath = fileURLToPath(
  new URL("../../../packages/sandbox-rs-napi/", import.meta.url),
);
const nativeEntrypointPath = fileURLToPath(
  new URL("../../../packages/sandbox-rs-napi/dist/index.js", import.meta.url),
);
const nativeSourcePaths = [
  fileURLToPath(new URL("../../../packages/sandbox-rs-napi/build.rs", import.meta.url)),
  fileURLToPath(new URL("../../../packages/sandbox-rs-napi/Cargo.toml", import.meta.url)),
  fileURLToPath(new URL("../../../packages/sandbox-rs-napi/Cargo.lock", import.meta.url)),
  fileURLToPath(new URL("../../../packages/sandbox-rs-napi/package.json", import.meta.url)),
  ...readFilePathsRecursively(
    fileURLToPath(new URL("../../../packages/sandbox-rs-napi/src/", import.meta.url)),
  ),
];

function readFilePathsRecursively(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = `${directoryPath}/${entry.name}`;
    if (entry.isDirectory()) {
      return readFilePathsRecursively(entryPath);
    }

    return entryPath;
  });
}

function readLatestModificationTimeMs(filePaths) {
  return Math.max(...filePaths.map((filePath) => statSync(filePath).mtimeMs));
}

function nativeBuildIsCurrent() {
  try {
    const builtAtMs = statSync(nativeEntrypointPath).mtimeMs;
    return builtAtMs >= readLatestModificationTimeMs(nativeSourcePaths);
  } catch {
    return false;
  }
}

if (!nativeBuildIsCurrent()) {
  const result = spawnSync("pnpm", ["--filter", "@mistle/sandbox-rs-napi", "build"], {
    cwd: nativePackageRootPath,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error("failed to build @mistle/sandbox-rs-napi before running tests");
  }
}
