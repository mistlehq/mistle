import { describe, expect, it } from "vitest";

import {
  DesignerEvalCodexAppServerListenUrl,
  createDesignerEvalCodexAppServerCommand,
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
      "/var/lib/mistle/codex-app-server-ws-token",
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
      "/var/lib/mistle/codex-app-server-ws-token",
    ]);
  });

  it("rejects malformed listen flags", () => {
    expect(() =>
      createDesignerEvalCodexAppServerCommand(["codex", "app-server", "--listen"]),
    ).toThrow("--listen without a value");
  });
});
