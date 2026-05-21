import { describe, expect, it } from "vitest";

import { createSessionRuntimeCliPtySessionId } from "./session-runtime-cli-launch.js";

describe("createSessionRuntimeCliPtySessionId", () => {
  it("creates a fresh direct PTY transport session id for each CLI handoff", () => {
    const firstId = createSessionRuntimeCliPtySessionId();
    const secondId = createSessionRuntimeCliPtySessionId();

    expect(firstId).toMatch(/^cli_[0-9a-f-]{36}$/u);
    expect(secondId).toMatch(/^cli_[0-9a-f-]{36}$/u);
    expect(secondId).not.toBe(firstId);
  });
});
