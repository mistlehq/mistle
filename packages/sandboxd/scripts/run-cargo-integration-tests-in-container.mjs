import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const testsDirectory = path.join(packageDirectory, "tests");
const requestedTargets = process.argv.slice(2).filter((argument) => argument !== "--");

const integrationTestTargets =
  requestedTargets.length === 0 ? discoverIntegrationTestTargets() : normalizeRequestedTargets();

if (integrationTestTargets.length === 0) {
  throw new Error(`No Rust integration test targets found in ${testsDirectory}`);
}

const containerRunnerScript = path.join(scriptDirectory, "run-cargo-in-container.mjs");
const containerRunnerArguments = [
  containerRunnerScript,
  "nextest",
  "run",
  "--locked",
  ...integrationTestTargets.flatMap((target) => ["--test", target]),
];

const result = spawnSync(process.execPath, containerRunnerArguments, {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

function discoverIntegrationTestTargets() {
  return readdirSync(testsDirectory, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".rs"))
    .map((entry) => path.parse(entry.name).name)
    .sort();
}

function normalizeRequestedTargets() {
  return requestedTargets.map((target) => {
    const parsedTarget = path.parse(target);
    if (parsedTarget.ext === ".rs") {
      return parsedTarget.name;
    }

    return target;
  });
}
