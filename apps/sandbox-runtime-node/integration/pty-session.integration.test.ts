import type { StreamOpen } from "@mistle/sandbox-session-protocol";
import { describe, expect, it } from "vitest";

import { PtySessionOutputClosedError, startPtySession } from "../src/tunnel/pty-session.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function createPtyStreamOpen(): StreamOpen {
  return {
    type: "stream.open",
    streamId: 1,
    channel: {
      kind: "pty",
      session: "create",
      cols: 80,
      rows: 24,
    },
  };
}

describe("PtySession", () => {
  async function collectPtyOutputUntilClosed(session: ReturnType<typeof startPtySession>) {
    const outputChunks: string[] = [];

    while (true) {
      try {
        const output = await session.nextOutput(new AbortController().signal);
        outputChunks.push(textDecoder.decode(output, { stream: true }));
      } catch (error) {
        if (error instanceof PtySessionOutputClosedError) {
          return outputChunks.join("");
        }

        throw error;
      }
    }
  }

  it("inherits the process environment through the native pty host", async () => {
    const previousGhToken = process.env.GH_TOKEN;

    try {
      process.env.GH_TOKEN = "dummy-token";
      const session = startPtySession(createPtyStreamOpen());
      const outputCollector = collectPtyOutputUntilClosed(session);

      session.write(
        textEncoder.encode("printf '__MISTLE_GH_TOKEN__%s__\\n' \"$GH_TOKEN\"\nexit 0\n"),
      );

      const exitCode = await session.waitForExit();
      const output = await outputCollector;

      expect(exitCode).toBe(0);
      expect(output).toContain("__MISTLE_GH_TOKEN__dummy-token__");
    } finally {
      if (previousGhToken === undefined) {
        delete process.env.GH_TOKEN;
      } else {
        process.env.GH_TOKEN = previousGhToken;
      }
    }
  });

  it("keeps nextOutput closed after a clean PTY exit", async () => {
    const session = startPtySession(createPtyStreamOpen());

    session.write(textEncoder.encode("exit 0\n"));

    const output = await collectPtyOutputUntilClosed(session);
    const exitCode = await session.waitForExit();

    expect(exitCode).toBe(0);
    expect(output.length).toBeGreaterThan(0);
    await expect(session.nextOutput(new AbortController().signal)).rejects.toBeInstanceOf(
      PtySessionOutputClosedError,
    );
  });

  it("captures PTY output emitted immediately on startup", async () => {
    const session = startPtySession(createPtyStreamOpen());

    try {
      const output = await session.nextOutput(AbortSignal.timeout(2_000));

      expect(output.length).toBeGreaterThan(0);
    } finally {
      await session.terminate();
      await collectPtyOutputUntilClosed(session);
    }
  });

  it("terminates a long-running PTY session", async () => {
    const session = startPtySession(createPtyStreamOpen());
    const outputCollector = collectPtyOutputUntilClosed(session);

    session.write(textEncoder.encode("sleep 30\n"));

    const exitCode = await session.terminate();
    const waitedExitCode = await session.waitForExit();
    const output = await outputCollector;

    expect(session.isExited()).toBe(true);
    expect(waitedExitCode).toBe(exitCode);
    expect(output).toContain("sleep 30");
    await expect(session.nextOutput(new AbortController().signal)).rejects.toBeInstanceOf(
      PtySessionOutputClosedError,
    );
  });
});
