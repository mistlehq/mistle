import fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const originalRmdir = fs.promises.rmdir.bind(fs.promises);

fs.promises.rmdir = async function patchedRmdir(path, options) {
  if (options?.recursive === true) {
    await fs.promises.rm(path, {
      force: options.force === true,
      recursive: true,
    });
    return;
  }

  return originalRmdir(path, options);
};

syncBuiltinESMExports();

const require = createRequire(import.meta.url);
const jsxEmailPackageJsonPath = require.resolve("jsx-email/package.json");
const jsxEmailBinPath = `${dirname(jsxEmailPackageJsonPath)}/bin/email`;

await import(pathToFileURL(jsxEmailBinPath).href);
