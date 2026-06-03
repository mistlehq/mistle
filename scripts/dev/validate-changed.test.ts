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

  it("plans changed app integration test files through the package integration config", () => {
    const commands = getDryRunCommands(
      "apps/control-plane-api/integration/auth-methods.integration.test.ts",
    );
    const integrationCommand = getRequiredCommand(
      commands,
      "pnpm --dir apps/control-plane-api exec vitest run -c vitest.integration.config.ts --passWithNoTests",
    );

    expect(integrationCommand).toContain(
      "apps/control-plane-api/integration/auth-methods.integration.test.ts",
    );
    expect(commands.find((command) => command.startsWith("turbo run test")) ?? "").not.toContain(
      "--filter @mistle/control-plane-api",
    );
  });

  it("plans changed package integration test files through the package integration config", () => {
    const commands = getDryRunCommands(
      "packages/test-harness/integration/environment-parallel.integration.test.ts",
    );
    const integrationCommand = getRequiredCommand(
      commands,
      "pnpm --dir packages/test-harness exec vitest run -c vitest.integration.config.ts --passWithNoTests",
    );

    expect(integrationCommand).toContain(
      "packages/test-harness/integration/environment-parallel.integration.test.ts",
    );
    expect(commands.find((command) => command.startsWith("turbo run test")) ?? "").not.toContain(
      "--filter @mistle/test-harness",
    );
  });

  it("plans changed integration test files for integration packages outside the unit-test allow-list", () => {
    const cacheCommands = getDryRunCommands(
      "packages/cache/integration/valkey-cache-adapter.integration.test.ts",
    );
    const integrationsDefinitionsCommands = getDryRunCommands(
      "packages/integrations-definitions/integration/linear-webhook-source.integration.test.ts",
    );
    const cacheIntegrationCommand = getRequiredCommand(
      cacheCommands,
      "pnpm --dir packages/cache exec vitest run -c vitest.integration.config.ts --passWithNoTests",
    );
    const integrationsDefinitionsIntegrationCommand = getRequiredCommand(
      integrationsDefinitionsCommands,
      "pnpm --dir packages/integrations-definitions exec vitest run -c vitest.integration.config.ts --passWithNoTests",
    );

    expect(cacheIntegrationCommand).toContain(
      "packages/cache/integration/valkey-cache-adapter.integration.test.ts",
    );
    expect(integrationsDefinitionsIntegrationCommand).toContain(
      "packages/integrations-definitions/integration/linear-webhook-source.integration.test.ts",
    );
    expect(
      cacheCommands.find((command) => command.startsWith("turbo run test")) ?? "",
    ).not.toContain("--filter @mistle/cache");
    expect(
      integrationsDefinitionsCommands.find((command) => command.startsWith("turbo run test")) ?? "",
    ).not.toContain("--filter @mistle/integrations-definitions");
  });

  it("keeps the full package test when integration test files are selected by repo-wide changes", () => {
    const commands = getDryRunCommands(
      ["package.json", "apps/control-plane-api/integration/auth-methods.integration.test.ts"].join(
        ",",
      ),
    );
    const integrationCommand = getRequiredCommand(
      commands,
      "pnpm --dir apps/control-plane-api exec vitest run -c vitest.integration.config.ts --passWithNoTests",
    );
    const turboCommand = getRequiredCommand(commands, "turbo run test");

    expect(integrationCommand).toContain(
      "apps/control-plane-api/integration/auth-methods.integration.test.ts",
    );
    expect(turboCommand).toContain("--filter @mistle/control-plane-api");
  });

  it("keeps affected package integration tests when repo-wide changes select the package", () => {
    const commands = getDryRunCommands(
      ["package.json", "apps/dashboard/integration/auth-session.integration.test.ts"].join(","),
    );
    const integrationCommand = getRequiredCommand(
      commands,
      "pnpm --dir apps/dashboard exec vitest run -c vitest.integration.config.ts --passWithNoTests",
    );
    const turboCommand = getRequiredCommand(commands, "turbo run test");

    expect(integrationCommand).toContain(
      "apps/dashboard/integration/auth-session.integration.test.ts",
    );
    expect(turboCommand).toContain("--filter @mistle/dashboard");
  });

  it("keeps affected package integration tests when unsupported package files require full tests", () => {
    const commands = getDryRunCommands(
      [
        "apps/dashboard/integration/auth-session.integration.test.ts",
        "apps/dashboard/src/index.css",
      ].join(","),
    );
    const integrationCommand = getRequiredCommand(
      commands,
      "pnpm --dir apps/dashboard exec vitest run -c vitest.integration.config.ts --passWithNoTests",
    );
    const turboCommand = getRequiredCommand(commands, "turbo run test");

    expect(integrationCommand).toContain(
      "apps/dashboard/integration/auth-session.integration.test.ts",
    );
    expect(turboCommand).toContain("--filter @mistle/dashboard");
  });

  it("keeps full package tests when affected package integration tests change with supported source files", () => {
    const commands = getDryRunCommands(
      [
        "apps/dashboard/integration/auth-session.integration.test.ts",
        "apps/dashboard/src/main.tsx",
      ].join(","),
    );
    const integrationCommand = getRequiredCommand(
      commands,
      "pnpm --dir apps/dashboard exec vitest run -c vitest.integration.config.ts --passWithNoTests",
    );
    const turboCommand = getRequiredCommand(commands, "turbo run test");

    expect(integrationCommand).toContain(
      "apps/dashboard/integration/auth-session.integration.test.ts",
    );
    expect(turboCommand).toContain("--filter @mistle/dashboard");
  });

  it("falls back to full package tests when affected package integration test files are deleted", () => {
    const commands = getDryRunCommands("apps/dashboard/integration/deleted.integration.test.ts");
    const turboCommand = getRequiredCommand(commands, "turbo run test");

    expect(turboCommand).toContain("--filter @mistle/dashboard");
  });

  it("falls back to full package tests when affected package unit test files are deleted", () => {
    const commands = getDryRunCommands("apps/dashboard/src/deleted.test.ts");
    const turboCommand = getRequiredCommand(commands, "turbo run test");

    expect(turboCommand).toContain("--filter @mistle/dashboard");
  });

  it("runs existing affected package integration tests when another changed integration test was deleted", () => {
    const commands = getDryRunCommands(
      [
        "apps/dashboard/integration/auth-session.integration.test.ts",
        "apps/dashboard/integration/deleted.integration.test.ts",
      ].join(","),
    );
    const integrationCommand = getRequiredCommand(
      commands,
      "pnpm --dir apps/dashboard exec vitest run -c vitest.integration.config.ts --passWithNoTests",
    );
    const turboCommand = getRequiredCommand(commands, "turbo run test");

    expect(integrationCommand).toContain(
      "apps/dashboard/integration/auth-session.integration.test.ts",
    );
    expect(turboCommand).toContain("--filter @mistle/dashboard");
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

function getRequiredCommand(commands: readonly string[], prefix: string): string {
  const command = commands.find((candidate) => candidate.startsWith(prefix));
  if (command === undefined) {
    throw new Error(`Expected dry-run commands to include a command starting with: ${prefix}`);
  }

  return command;
}
