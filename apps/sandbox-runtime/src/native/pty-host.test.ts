import { describe, expect, it } from "vitest";

import { resolveDefaultPtyShell } from "./pty-host.js";

describe("resolveDefaultPtyShell", () => {
  it("uses bash for interactive terminal sessions", () => {
    expect(resolveDefaultPtyShell()).toBe("/bin/bash");
  });
});
