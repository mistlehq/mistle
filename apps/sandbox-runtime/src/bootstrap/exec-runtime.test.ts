import { describe, expect, it } from "vitest";

import { buildPackagedRuntimeExecInput, buildRuntimeExecInput } from "./runtime-exec-input.js";

describe("buildRuntimeExecInput", () => {
  it("filters bootstrap-owned environment keys and injects root values", () => {
    const input = buildRuntimeExecInput({
      processEnv: {
        KEEP_ME: "value",
        HOME: "/root",
        LOGNAME: "root",
        USER: "root",
        SANDBOX_RUNTIME_PROXY_CA_CERT_FD: "99",
      },
      processArgv: ["/usr/local/bin/node", "/tmp/dist/main.js", "bootstrap-runtime"],
      runtimeEntrypointPath: "/tmp/dist/main.js",
      targetIdentity: {
        username: "root",
        uid: 0,
        gid: 0,
        homeDir: "/root",
      },
      additionalEnv: {
        SANDBOX_RUNTIME_PROXY_CA_CERT_FD: "12",
      },
    });

    expect(input).toEqual({
      uid: 0,
      gid: 0,
      command: process.execPath,
      args: ["/tmp/dist/main.js", "runtime-internal"],
      env: [
        {
          name: "KEEP_ME",
          value: "value",
        },
        {
          name: "HOME",
          value: "/root",
        },
        {
          name: "LOGNAME",
          value: "root",
        },
        {
          name: "USER",
          value: "root",
        },
        {
          name: "SANDBOX_RUNTIME_PROXY_CA_CERT_FD",
          value: "12",
        },
      ],
    });
  });
});

describe("buildPackagedRuntimeExecInput", () => {
  it("targets the packaged runtime binary and rewrites bootstrap-runtime", () => {
    const input = buildPackagedRuntimeExecInput({
      processEnv: {
        KEEP_ME: "value",
        HOME: "/root",
        LOGNAME: "root",
        USER: "root",
        SANDBOX_RUNTIME_PROXY_CA_KEY_FD: "88",
      },
      processArgv: ["/tmp/sandboxd", "/tmp/sandboxd", "bootstrap-runtime", "--trace", "child"],
      runtimeExecutablePath: "/tmp/sandboxd",
      targetIdentity: {
        username: "root",
        uid: 0,
        gid: 0,
        homeDir: "/root",
      },
      additionalEnv: {
        SANDBOX_RUNTIME_PROXY_CA_KEY_FD: "12",
      },
    });

    expect(input).toEqual({
      uid: 0,
      gid: 0,
      command: "/tmp/sandboxd",
      args: ["runtime-internal", "--trace", "child"],
      env: [
        {
          name: "KEEP_ME",
          value: "value",
        },
        {
          name: "HOME",
          value: "/root",
        },
        {
          name: "LOGNAME",
          value: "root",
        },
        {
          name: "USER",
          value: "root",
        },
        {
          name: "SANDBOX_RUNTIME_PROXY_CA_KEY_FD",
          value: "12",
        },
      ],
    });
  });
});
