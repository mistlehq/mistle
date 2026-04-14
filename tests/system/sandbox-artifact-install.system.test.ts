/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { describe, expect } from "vitest";

import { it } from "./system-test-context.js";

const TestTimeoutMs = 5 * 60_000;
const InstalledMarker = "CODEX_ARTIFACT_READY";

describe("sandbox artifact install", () => {
  it(
    "installs the Codex CLI artifact into the sandbox filesystem",
    { timeout: TestTimeoutMs },
    async ({ fixture }) => {
      const sandboxInstanceId = await fixture.startSandboxAndWaitReady();
      const result = await fixture.runSandboxPtyCommand({
        sandboxInstanceId,
        command: [
          "command -v codex",
          "test -x /usr/local/bin/codex",
          'test "$(command -v codex)" = /usr/local/bin/codex',
          "codex --version >/dev/null",
          `printf '%s\\n' '${InstalledMarker}'`,
        ].join(" && "),
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("/usr/local/bin/codex");
      expect(result.output).toContain(InstalledMarker);
    },
  );
});
