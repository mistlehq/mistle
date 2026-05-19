import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const containerRunnerScript = path.join(scriptDirectory, "run-cargo-in-container.mjs");

const stressCases = [
  {
    name: "codex-session-manager-release-failure-replay",
    envName: "MISTLE_SANDBOXD_STRESS_COUNT_CODEX_SESSION_MANAGER_RELEASE_FAILURE_REPLAY",
    defaultStressCount: 20,
    arguments: [
      "nextest",
      "run",
      "--locked",
      "--test",
      "codex_proxy",
      "session_manager_preserves_retained_state_when_release_unsubscribe_fails",
    ],
  },
  {
    name: "codex-session-manager-reconnect-replay",
    envName: "MISTLE_SANDBOXD_STRESS_COUNT_CODEX_SESSION_MANAGER_RECONNECT_REPLAY",
    defaultStressCount: 20,
    arguments: [
      "nextest",
      "run",
      "--locked",
      "--test",
      "codex_proxy",
      "session_manager_reconnect_replay_removes_missing_rollout_and_allows_retain_again",
    ],
  },
  {
    name: "tunnel-session-bootstrap-reconnect",
    envName: "MISTLE_SANDBOXD_STRESS_COUNT_TUNNEL_SESSION_BOOTSTRAP_RECONNECT",
    defaultStressCount: 10,
    arguments: [
      "nextest",
      "run",
      "--locked",
      "--lib",
      "reconnects_after_bootstrap_websocket_loss_and_rolls_exchange_token_forward",
    ],
  },
  {
    name: "tunnel-port-access-websocket-transport",
    envName: "MISTLE_SANDBOXD_STRESS_COUNT_TUNNEL_PORT_ACCESS_WEBSOCKET_TRANSPORT",
    defaultStressCount: 10,
    arguments: [
      "nextest",
      "run",
      "--locked",
      "--lib",
      "relays_port_access_websocket_frames_and_close_frames",
    ],
  },
];

const selectedStressCases = resolveSelectedStressCases(stressCases);
const stressMultiplier = resolveStressMultiplier();

for (const stressCase of selectedStressCases) {
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
    return stressCase.defaultStressCount * stressMultiplier;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `Expected ${stressCase.envName} to be a positive integer, received '${rawValue}'.`,
    );
  }

  return parsedValue;
}

function resolveSelectedStressCases(allStressCases) {
  const rawValue = process.env.MISTLE_SANDBOXD_STRESS_CASES;
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return allStressCases;
  }

  const selectedNames = rawValue
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (selectedNames.length === 0) {
    throw new Error(
      "Expected MISTLE_SANDBOXD_STRESS_CASES to include at least one case name when provided.",
    );
  }

  const selectedStressCases = selectedNames.map((selectedName) => {
    const matchingStressCase = allStressCases.find(
      (stressCase) => stressCase.name === selectedName,
    );
    if (matchingStressCase === undefined) {
      throw new Error(
        `Unknown sandboxd stress case '${selectedName}'. Supported cases: ${allStressCases
          .map((stressCase) => stressCase.name)
          .join(", ")}.`,
      );
    }

    return matchingStressCase;
  });

  return selectedStressCases;
}

function resolveStressMultiplier() {
  const rawValue = process.env.MISTLE_SANDBOXD_STRESS_MULTIPLIER;
  if (rawValue === undefined) {
    return 1;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `Expected MISTLE_SANDBOXD_STRESS_MULTIPLIER to be a positive integer, received '${rawValue}'.`,
    );
  }

  return parsedValue;
}
