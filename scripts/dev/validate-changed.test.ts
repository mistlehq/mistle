import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const RepositoryRootPath = fileURLToPath(new URL("../..", import.meta.url));

describe("validate-changed", () => {
  it("does not plan containerized Rust tests for non-Rust repo-wide changes", () => {
    const commands = getDryRunCommands("pnpm-lock.yaml");

    expect(commands.join("\n")).not.toContain("@mistle/commit-sign");
    expect(commands.join("\n")).not.toContain("@mistle/sandboxd");
  });

  it("plans containerized Rust tests for Rust package changes", () => {
    const commands = getDryRunCommands("packages/sandboxd/src/main.rs");

    expect(commands.join("\n")).toContain("@mistle/sandboxd");
  });

  it("keeps targeted Rust integration test runs for changed Rust test files", () => {
    const commands = getDryRunCommands("packages/sandboxd/tests/bootstrap_exec.rs");

    expect(commands).toContain(
      "pnpm --dir packages/sandboxd run test:integration -- packages/sandboxd/tests/bootstrap_exec.rs",
    );
  });
});

function getDryRunCommands(files: string): string[] {
  const output = execFileSync(
    "pnpm",
    ["validate:changed", "--dry-run", "--files", files, "--steps", "test"],
    {
      cwd: RepositoryRootPath,
      encoding: "utf8",
    },
  );

  const commandsStartIndex = output.indexOf("\nCommands (");
  if (commandsStartIndex === -1) {
    throw new Error(`validate-changed dry run did not print a Commands section:\n${output}`);
  }

  return output
    .slice(commandsStartIndex)
    .split("\n")
    .filter((line) => line.startsWith("  - "))
    .map((line) => line.slice("  - ".length));
}
