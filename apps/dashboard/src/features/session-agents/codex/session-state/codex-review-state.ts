import { ExecStreamClient, type SandboxSessionTransport } from "@mistle/sandbox-session-client";

const ReviewGitCommandTimeoutMs = 5_000;
const MaxReviewCommitOptions = 50;

export type CodexReviewCommand =
  | { kind: "showTargetPicker" }
  | { kind: "customInstructions"; instructions: string };

export type CodexReviewCommandParseResult =
  | { status: "notReviewCommand" }
  | { status: "valid"; command: CodexReviewCommand };

export type CodexReviewCommitOption = {
  sha: string;
  title: string;
};

export type CodexReviewPanel =
  | { kind: "targetPicker" }
  | { kind: "branchPicker"; branches: readonly string[] | null }
  | { kind: "commitPicker"; commits: readonly CodexReviewCommitOption[] | null };

export function codexReviewStartIsBlockedByTurnStatus(status: string | null): boolean {
  return status === "inProgress";
}

export function parseCodexReviewCommand(input: string): CodexReviewCommandParseResult {
  const trimmedInput = input.trim();
  if (!trimmedInput.startsWith("/review")) {
    return { status: "notReviewCommand" };
  }

  const reviewPrefixLength = "/review".length;
  if (
    trimmedInput.length > reviewPrefixLength &&
    !/\s/.test(trimmedInput.charAt(reviewPrefixLength))
  ) {
    return { status: "notReviewCommand" };
  }

  const rest = trimmedInput.slice(reviewPrefixLength).trim();
  if (rest.length === 0) {
    return {
      status: "valid",
      command: { kind: "showTargetPicker" },
    };
  }

  return {
    status: "valid",
    command: {
      kind: "customInstructions",
      instructions: rest,
    },
  };
}

export async function loadCodexReviewBranches(input: {
  cwd: string;
  transport: SandboxSessionTransport;
}): Promise<readonly string[]> {
  const result = await runReviewGitCommand({
    args: ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"],
    cwd: input.cwd,
    transport: input.transport,
  });

  return parseCodexReviewBranchList(result.stdout);
}

export function parseCodexReviewBranchList(stdout: string): readonly string[] {
  const seenBranches = new Set<string>();
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((branch) => branch !== "HEAD")
    .filter((branch) => !branch.endsWith("/HEAD"))
    .filter((branch) => {
      if (seenBranches.has(branch)) {
        return false;
      }
      seenBranches.add(branch);
      return true;
    })
    .sort((left, right) => left.localeCompare(right));
}

export async function loadCodexReviewCommits(input: {
  cwd: string;
  transport: SandboxSessionTransport;
}): Promise<readonly CodexReviewCommitOption[]> {
  const result = await runReviewGitCommand({
    args: ["log", `--max-count=${String(MaxReviewCommitOptions)}`, "--pretty=format:%H%x00%s"],
    cwd: input.cwd,
    transport: input.transport,
  });

  return result.stdout
    .split("\n")
    .map(parseCommitLine)
    .filter((commit) => commit !== null);
}

async function runReviewGitCommand(input: {
  args: string[];
  cwd: string;
  transport: SandboxSessionTransport;
}) {
  const exec = new ExecStreamClient({
    transport: input.transport,
  });
  const result = await exec.run({
    args: input.args,
    command: "git",
    cwd: input.cwd,
    timeoutMs: ReviewGitCommandTimeoutMs,
  });

  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].find((value) => value.length > 0);
    throw new Error(details ?? "Git command failed.");
  }

  return result;
}

function parseCommitLine(line: string): CodexReviewCommitOption | null {
  const separatorIndex = line.indexOf("\0");
  if (separatorIndex <= 0) {
    return null;
  }

  const sha = line.slice(0, separatorIndex).trim();
  const title = line.slice(separatorIndex + 1).trim();
  if (sha.length === 0 || title.length === 0) {
    return null;
  }

  return { sha, title };
}
