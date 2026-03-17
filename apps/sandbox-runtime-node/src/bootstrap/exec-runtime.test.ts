import { describe, expect, it } from "vitest";

import { buildRuntimeExecArgs, buildRuntimeExecInput } from "./runtime-exec-input.js";

describe("buildRuntimeExecArgs", () => {
  it("replaces the bootstrap entrypoint for a built node invocation", () => {
    expect(
      buildRuntimeExecArgs(
        ["/usr/local/bin/node", "/tmp/dist/bootstrap/main.js"],
        "/tmp/dist/bootstrap/main.js",
        "/tmp/dist/main.js",
      ),
    ).toEqual(["/tmp/dist/main.js"]);
  });

  it("replaces the bootstrap entrypoint for a tsx watch invocation", () => {
    expect(
      buildRuntimeExecArgs(
        [
          "/usr/local/bin/node",
          "/tmp/node_modules/tsx/dist/cli.mjs",
          "watch",
          "/workspace/src/bootstrap/main.ts",
        ],
        "/workspace/src/bootstrap/main.ts",
        "/workspace/src/main.ts",
      ),
    ).toEqual(["/tmp/node_modules/tsx/dist/cli.mjs", "watch", "/workspace/src/main.ts"]);
  });

  it("fails when the bootstrap entrypoint is not present in argv", () => {
    expect(() =>
      buildRuntimeExecArgs(
        ["/usr/local/bin/node", "/tmp/dist/main.js"],
        "/tmp/dist/bootstrap/main.js",
        "/tmp/dist/main.js",
      ),
    ).toThrow('failed to locate bootstrap entrypoint "/tmp/dist/bootstrap/main.js" in argv');
  });
});

describe("buildRuntimeExecInput", () => {
  it("filters bootstrap-owned environment keys and injects sandbox user values", () => {
    const input = buildRuntimeExecInput({
      processEnv: {
        KEEP_ME: "value",
        HOME: "/root",
        LOGNAME: "root",
        USER: "root",
        SANDBOX_RUNTIME_PROXY_CA_CERT_FD: "99",
      },
      processArgv: ["/usr/local/bin/node", "/tmp/dist/bootstrap/main.js"],
      bootstrapEntrypointPath: "/tmp/dist/bootstrap/main.js",
      runtimeEntrypointPath: "/tmp/dist/main.js",
      userRecord: {
        username: "sandbox",
        uid: 1000,
        gid: 1000,
        homeDir: "/home/sandbox",
      },
      additionalEnv: {
        SANDBOX_RUNTIME_PROXY_CA_CERT_FD: "12",
      },
    });

    expect(input).toEqual({
      uid: 1000,
      gid: 1000,
      command: process.execPath,
      args: ["/tmp/dist/main.js"],
      env: [
        {
          name: "KEEP_ME",
          value: "value",
        },
        {
          name: "HOME",
          value: "/home/sandbox",
        },
        {
          name: "LOGNAME",
          value: "sandbox",
        },
        {
          name: "USER",
          value: "sandbox",
        },
        {
          name: "SANDBOX_RUNTIME_PROXY_CA_CERT_FD",
          value: "12",
        },
      ],
    });
  });
});
