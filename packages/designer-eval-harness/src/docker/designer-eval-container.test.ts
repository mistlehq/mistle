import { describe, expect, it } from "vitest";

import {
  DesignerEvalCodexAppServerListenUrl,
  createDesignerEvalCodexAppServerCommand,
  createDesignerEvalMaterializedFileDirectoryMounts,
} from "./designer-eval-container.ts";

describe("createDesignerEvalCodexAppServerCommand", () => {
  it("replaces the sandbox-local listen URL with a Docker-reachable listen URL", () => {
    expect(
      createDesignerEvalCodexAppServerCommand([
        "/usr/local/bin/codex",
        "app-server",
        "--listen",
        "ws://127.0.0.1:4501",
      ]),
    ).toEqual([
      "/usr/local/bin/codex",
      "app-server",
      "--listen",
      DesignerEvalCodexAppServerListenUrl,
      "--ws-auth",
      "capability-token",
      "--ws-token-file",
      "/tmp/mistle-codex-app-server-ws-token",
    ]);
  });

  it("adds a Docker-reachable listen URL when the command has no listen flag", () => {
    expect(createDesignerEvalCodexAppServerCommand(["codex", "app-server"])).toEqual([
      "codex",
      "app-server",
      "--listen",
      DesignerEvalCodexAppServerListenUrl,
      "--ws-auth",
      "capability-token",
      "--ws-token-file",
      "/tmp/mistle-codex-app-server-ws-token",
    ]);
  });

  it("rejects malformed listen flags", () => {
    expect(() =>
      createDesignerEvalCodexAppServerCommand(["codex", "app-server", "--listen"]),
    ).toThrow("--listen without a value");
  });
});

describe("createDesignerEvalMaterializedFileDirectoryMounts", () => {
  it("mounts materialized runtime setup directories instead of file targets", () => {
    expect(
      createDesignerEvalMaterializedFileDirectoryMounts([
        {
          fileId: "codex_config",
          runtimePath: "/etc/codex/config.toml",
          localPath: "/tmp/eval/runtime-files/etc/codex/config.toml",
        },
        {
          fileId: "codex_global_agents",
          runtimePath: "/root/.codex/AGENTS.md",
          localPath: "/tmp/eval/runtime-files/root/.codex/AGENTS.md",
        },
        {
          fileId: "designer_integration_catalog",
          runtimePath: "/root/.mistle/designer/references/integration-catalog.md",
          localPath:
            "/tmp/eval/runtime-files/root/.mistle/designer/references/integration-catalog.md",
        },
      ]),
    ).toEqual([
      {
        source: "/tmp/eval/runtime-files/etc/codex",
        target: "/etc/codex",
        mode: "ro",
      },
      {
        source: "/tmp/eval/runtime-files/root/.codex",
        target: "/root/.codex",
        mode: "rw",
      },
      {
        source: "/tmp/eval/runtime-files/root/.mistle",
        target: "/root/.mistle",
        mode: "ro",
      },
    ]);
  });
});
