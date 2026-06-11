import { describe, expect, it } from "vitest";

import { ModalStartSandboxdDaemonCommand } from "./runtime-control.js";

describe("Modal sandbox runtime control", () => {
  it("starts sandboxd in the background and waits for the control socket", () => {
    expect(ModalStartSandboxdDaemonCommand).toContain(
      "exec /opt/mistle/bin/sandboxd >/run/mistle/sandboxd.log 2>&1",
    );
    expect(ModalStartSandboxdDaemonCommand).not.toContain("nohup");
  });
});
