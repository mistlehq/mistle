import { execFileSync } from "node:child_process";
import path from "node:path";

const packageRoot = process.cwd();
const repoRelativePrefix = "packages/commit-sign/";

const args = process.argv.slice(2);
const check = args[0] === "--check";
const pathArgs = check ? args.slice(1) : args;

const normalizedPathArgs = pathArgs.map((arg) => {
  if (path.isAbsolute(arg)) {
    return path.relative(packageRoot, arg);
  }

  if (arg.startsWith(repoRelativePrefix)) {
    return arg.slice(repoRelativePrefix.length);
  }

  return arg;
});

const cargoArgs = ["fmt"];
if (check) {
  cargoArgs.push("--check");
}
if (normalizedPathArgs.length > 0) {
  cargoArgs.push("--", ...normalizedPathArgs);
}

execFileSync("cargo", cargoArgs, {
  cwd: packageRoot,
  stdio: "inherit",
});
