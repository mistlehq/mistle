import { describe, expect, it } from "vitest";

import { createControlPlaneStartupCommands } from "./start-commands.js";

describe("createControlPlaneStartupCommands", () => {
  it("syncs integration targets after control-plane database migrations", () => {
    expect(createControlPlaneStartupCommands()).toEqual([
      {
        label: "Running control-plane DB migrations...",
        command: "pnpm",
        args: ["--filter", "@mistle/control-plane-api", "db:migrate"],
      },
      {
        label: "Syncing integration targets...",
        command: "pnpm",
        args: ["--filter", "@mistle/control-plane-api", "integration-targets:sync"],
      },
      {
        label: "Running control-plane workflow migrations...",
        command: "pnpm",
        args: ["--filter", "@mistle/control-plane-api", "workflow:migrate"],
      },
    ]);
  });
});
