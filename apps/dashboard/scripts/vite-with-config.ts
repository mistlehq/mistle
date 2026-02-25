import { spawn } from "node:child_process";

import { loadDashboardBuildConfig } from "./build-config.js";

const supportedCommands = new Set(["dev", "build", "preview"]);

type ViteCommand = "dev" | "build" | "preview";

function resolveBuildEnvironment(command: ViteCommand): "development" | "production" {
  if (command === "dev") {
    return "development";
  }

  return "production";
}

function main(): void {
  const [, , commandArg, ...passthroughArgs] = process.argv;
  if (!commandArg || !supportedCommands.has(commandArg)) {
    console.error("Usage: tsx scripts/vite-with-config.ts <dev|build|preview> [vite args...]");
    process.exit(1);
  }

  let command: ViteCommand;
  if (commandArg === "dev" || commandArg === "build" || commandArg === "preview") {
    command = commandArg;
  } else {
    throw new Error("Unsupported vite command.");
  }
  const config = loadDashboardBuildConfig(process.env, resolveBuildEnvironment(command));

  const child = spawn("pnpm", ["exec", "vite", command, ...passthroughArgs], {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_CONTROL_PLANE_API_ORIGIN: config.controlPlaneApiOrigin,
    },
  });

  child.on("error", (error) => {
    throw error;
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
}

main();
