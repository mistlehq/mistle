import { execFile } from "node:child_process";
import { copyFile, mkdir, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CommitSignPackageRootPath = fileURLToPath(
  new URL("../../../../packages/commit-sign", import.meta.url),
);
const BuiltCommitSignBinaryPath = fileURLToPath(
  new URL("../../../../packages/commit-sign/target/debug/commit-sign", import.meta.url),
);
const RuntimeCommitSignBinaryPath = "/usr/local/bin/commit-sign";

let ensuredCommitSignBinaryPromise: Promise<string> | undefined;
let installedCommitSignBinaryPromise: Promise<string> | undefined;

export async function ensureCommitSignBinary(): Promise<string> {
  if (ensuredCommitSignBinaryPromise !== undefined) {
    return await ensuredCommitSignBinaryPromise;
  }

  ensuredCommitSignBinaryPromise = execFileAsync(
    "cargo",
    ["build", "--locked", "--bin", "commit-sign"],
    {
      cwd: CommitSignPackageRootPath,
      maxBuffer: 8 * 1024 * 1024,
    },
  ).then(() => BuiltCommitSignBinaryPath);

  return await ensuredCommitSignBinaryPromise;
}

export async function ensureCommitSignBinaryInstalled(): Promise<string> {
  if (installedCommitSignBinaryPromise !== undefined) {
    return await installedCommitSignBinaryPromise;
  }

  installedCommitSignBinaryPromise = (async () => {
    const builtBinaryPath = await ensureCommitSignBinary();
    await mkdir(dirname(RuntimeCommitSignBinaryPath), { recursive: true });
    await copyFile(builtBinaryPath, RuntimeCommitSignBinaryPath);
    await chmod(RuntimeCommitSignBinaryPath, 0o755);
    return RuntimeCommitSignBinaryPath;
  })();

  return await installedCommitSignBinaryPromise;
}
