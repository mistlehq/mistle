import { spawnSync } from "node:child_process";

function runMintCommand(args, label) {
  const result = spawnSync("pnpm", ["exec", "mint", ...args], {
    encoding: "utf8",
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const output = `${stdout}${stderr}`;

  if (stdout.length > 0) {
    process.stdout.write(stdout);
  }
  if (stderr.length > 0) {
    process.stderr.write(stderr);
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }

  if (/\bWARN\b/u.test(output)) {
    console.error(`Mint ${label} emitted warnings; failing lint.`);
    process.exit(1);
  }
}

runMintCommand(["broken-links"], "broken-links");
runMintCommand(["a11y"], "a11y");
