import { describe, expect, it } from "vitest";

import { resolveBootstrapLaunchTarget } from "./bootstrap-launch-target.js";

describe("resolveBootstrapLaunchTarget", () => {
  it("launches the packaged sandboxd bootstrap subcommand", () => {
    expect(
      resolveBootstrapLaunchTarget({
        packagedRuntimeExecutablePath: "/usr/local/bin/sandboxd",
        processExecArgv: [],
      }),
    ).toEqual({
      command: "/usr/local/bin/sandboxd",
      args: ["bootstrap-runtime"],
    });
  });

  it("launches the node runtime entrypoint with bootstrap-runtime", () => {
    expect(
      resolveBootstrapLaunchTarget({
        currentEntrypointPath: "/workspace/apps/sandbox-runtime/dist/main.js",
        processExecArgv: ["--inspect"],
      }),
    ).toEqual({
      command: process.execPath,
      args: ["--inspect", "/workspace/apps/sandbox-runtime/dist/main.js", "bootstrap-runtime"],
    });
  });
});
