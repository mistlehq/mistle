import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const ScriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const AppRootPath = resolve(ScriptDirectoryPath, "..");
const NativeAddonShimPath = resolve(AppRootPath, "scripts/sea/native-addon-shim.cjs");
const SeaSourceRootPath = resolve(AppRootPath, "src/sea");

export const SeaBundleFileNames = {
  BOOTSTRAP: "sandbox-bootstrap.cjs",
  RUNTIME: "sandboxd.cjs",
};

async function buildSeaBundle(input) {
  await build({
    entryPoints: [resolve(SeaSourceRootPath, input.entrypoint)],
    outfile: resolve(input.outputDirectoryPath, input.outputFileName),
    alias: {
      "@mistle/sandbox-rs-napi": NativeAddonShimPath,
    },
    bundle: true,
    format: "cjs",
    legalComments: "none",
    platform: "node",
    target: "node25",
  });
}

export async function buildSeaBundles(outputDirectoryPath) {
  await mkdir(outputDirectoryPath, { recursive: true });

  await Promise.all([
    buildSeaBundle({
      entrypoint: "bootstrap-main.ts",
      outputDirectoryPath,
      outputFileName: SeaBundleFileNames.BOOTSTRAP,
    }),
    buildSeaBundle({
      entrypoint: "runtime-main.ts",
      outputDirectoryPath,
      outputFileName: SeaBundleFileNames.RUNTIME,
    }),
  ]);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  const outputDirectoryPath = resolve(AppRootPath, "dist-sea/bundles");
  await rm(outputDirectoryPath, { force: true, recursive: true });
  await buildSeaBundles(outputDirectoryPath);
}
