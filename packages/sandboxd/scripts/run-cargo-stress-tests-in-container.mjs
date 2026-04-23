import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const containerRunnerScript = path.join(scriptDirectory, "run-cargo-in-container.mjs");

const stressCases = [
  {
    name: "pty-stream-relay-immediate-exit",
    envName: "MISTLE_SANDBOXD_STRESS_COUNT_PTY_STREAM_RELAY",
    defaultStressCount: 50,
    arguments: [
      "nextest",
      "run",
      "--locked",
      "--test",
      "pty_stream_relay",
      "relays_pty_output_and_exit_over_websocket",
    ],
  },
];

for (const stressCase of stressCases) {
  const stressCount = resolveStressCount(stressCase);
  const containerRunnerArguments = [
    containerRunnerScript,
    ...stressCase.arguments,
    "--stress-count",
    String(stressCount),
  ];

  process.stderr.write(`sandboxd stress: ${stressCase.name} (${stressCount} iterations)\n`);

  const result = spawnSync(process.execPath, containerRunnerArguments, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveStressCount(stressCase) {
  const rawValue = process.env[stressCase.envName];
  if (rawValue === undefined) {
    return stressCase.defaultStressCount;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `Expected ${stressCase.envName} to be a positive integer, received '${rawValue}'.`,
    );
  }

  return parsedValue;
}
