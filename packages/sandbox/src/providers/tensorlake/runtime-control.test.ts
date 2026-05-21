import { describe, expect, it } from "vitest";

import { createTensorlakeElevatedShellCommand } from "./runtime-control.js";

describe("createTensorlakeElevatedShellCommand", () => {
  it("runs sandboxd maintenance scripts with root privileges and preserves artifact env", () => {
    expect(createTensorlakeElevatedShellCommand({ script: "echo installing sandboxd" })).toEqual({
      command: "sudo",
      args: ["-E", "sh", "-euc", "echo installing sandboxd"],
    });
  });
});
