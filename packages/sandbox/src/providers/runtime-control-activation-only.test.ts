import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const RuntimeControlBoundarySourceFiles: readonly URL[] = [
  new URL("../types.ts", import.meta.url),
  new URL("./docker/runtime-control.ts", import.meta.url),
  new URL("./e2b/runtime-control.ts", import.meta.url),
  new URL("./tensorlake/runtime-control.ts", import.meta.url),
];

const ProviderRuntimeControlSourceFiles: readonly URL[] = [
  new URL("./docker/runtime-control.ts", import.meta.url),
  new URL("./e2b/client.ts", import.meta.url),
  new URL("./e2b/runtime-control.ts", import.meta.url),
  new URL("./tensorlake/client.ts", import.meta.url),
  new URL("./tensorlake/runtime-control.ts", import.meta.url),
];

const LegacyRuntimeControlMethodPatterns: readonly RegExp[] = [
  /\bbeginInit\s*\(/,
  /\bwaitInit\s*\(/,
  /\binit\s*\(\s*(?:input: SandboxRuntimeControlRequest|request: E2BInitRequest|request: TensorlakeRuntimeControlRequest)/,
  /\bresume\s*\(\s*(?:input: SandboxRuntimeControlRequest|request: E2BInitRequest|request: TensorlakeRuntimeControlRequest)/,
];

const LegacySandboxdLifecycleCommandPatterns: readonly RegExp[] = [
  /\/opt\/mistle\/bin\/sandboxd init/,
  /\/opt\/mistle\/bin\/sandboxd wait-init/,
  /\/opt\/mistle\/bin\/sandboxd resume/,
  /\["\/opt\/mistle\/bin\/sandboxd",\s*"init"/,
  /\["\/opt\/mistle\/bin\/sandboxd",\s*"wait-init"/,
  /\[\s*"init"\s*,\s*"--detach"\s*\]/,
  /\[\s*"init"\s*\]/,
  /\[\s*"wait-init"\s*\]/,
  /\[\s*"resume"\s*\]/,
  /\bInitCommand\b/,
  /\bDetachedInitCommand\b/,
  /\bWaitInitCommand\b/,
  /\bResumeCommand\b/,
  /\/run\/mistle\/init\.log/,
  /\/run\/mistle\/resume\.log/,
];

describe("provider runtime-control activation migration", () => {
  it("keeps the runtime-control boundary activation-only", async () => {
    for (const sourceFile of RuntimeControlBoundarySourceFiles) {
      const source = await readFile(sourceFile, "utf8");

      for (const legacyPattern of LegacyRuntimeControlMethodPatterns) {
        expect(source).not.toMatch(legacyPattern);
      }
    }
  });

  it("keeps providers from constructing legacy sandboxd lifecycle commands", async () => {
    for (const sourceFile of ProviderRuntimeControlSourceFiles) {
      const source = await readFile(sourceFile, "utf8");

      for (const legacyPattern of LegacySandboxdLifecycleCommandPatterns) {
        expect(source).not.toMatch(legacyPattern);
      }
    }
  });

  it("keeps each provider constructing sandboxd activate", async () => {
    const dockerRuntimeControlSource = await readFile(
      new URL("./docker/runtime-control.ts", import.meta.url),
      "utf8",
    );
    const e2bClientSource = await readFile(new URL("./e2b/client.ts", import.meta.url), "utf8");
    const tensorlakeClientSource = await readFile(
      new URL("./tensorlake/client.ts", import.meta.url),
      "utf8",
    );

    expect(dockerRuntimeControlSource).toContain('["/opt/mistle/bin/sandboxd", "activate"]');
    expect(e2bClientSource).toContain('"/opt/mistle/bin/sandboxd activate"');
    expect(tensorlakeClientSource).toContain('["activate"]');
  });
});
