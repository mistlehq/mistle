import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CommitSignPackageRootPath = fileURLToPath(
  new URL("../../../../packages/commit-sign", import.meta.url),
);
const CommitSignBinaryPath = fileURLToPath(
  new URL("../../../../packages/commit-sign/target/debug/commit-sign", import.meta.url),
);

let ensuredCommitSignBinaryPromise: Promise<string> | undefined;

export function getCommitSignBinaryPath(): string {
  return CommitSignBinaryPath;
}

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
  ).then(() => CommitSignBinaryPath);

  return await ensuredCommitSignBinaryPromise;
}
