/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { describe, expect } from "vitest";

import {
  connectCodexAgentSession,
  killRawCodexAppServer,
  prepareCodexSandbox,
  readSandboxHealthz,
  waitForCondition,
  type SandboxdHealthResponse,
} from "./helpers/codex-sandbox.js";
import { it } from "./system-test-context.js";

const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;

function requireHealthSnapshot(
  health: SandboxdHealthResponse,
): NonNullable<SandboxdHealthResponse["snapshot"]> {
  if (health.snapshot === null) {
    throw new Error("Expected sandboxd __healthz snapshot to be present.");
  }

  return health.snapshot;
}

function requireHealthComponent(
  health: SandboxdHealthResponse,
  component: "tunnel_session" | "codex_proxy" | "codex_app_server",
): NonNullable<SandboxdHealthResponse["snapshot"]>["components"][number] {
  const snapshot = requireHealthSnapshot(health);
  const matchedComponent = snapshot.components.find(
    (candidateComponent) => candidateComponent.component === component,
  );
  if (matchedComponent === undefined) {
    throw new Error(`Expected sandboxd __healthz to include component '${component}'.`);
  }

  return matchedComponent;
}

describe("system sandboxd healthz codex recovery", () => {
  it(
    "reflects codex component degradation and recovery through local __healthz",
    async ({ fixture }) => {
      const { authenticatedSession, sandboxInstanceId } = await prepareCodexSandbox({
        fixture,
        email: "sandboxd-healthz-codex-recovery@example.com",
      });
      const initialHealth = await readSandboxHealthz({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
      });
      expect(initialHealth.daemon_phase).toBe("initialized");
      expect(requireHealthComponent(initialHealth, "tunnel_session").state).toBe("healthy");
      expect(requireHealthComponent(initialHealth, "codex_proxy").state).toBe("healthy");
      expect(requireHealthComponent(initialHealth, "codex_app_server").state).toBe("healthy");

      const attachedAgentSession = await connectCodexAgentSession({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
      });

      try {
        await killRawCodexAppServer({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });

        const degradedHealth = await waitForCondition({
          description: "sandboxd __healthz codex degradation",
          timeoutMs: 30_000,
          pollIntervalMs: 100,
          evaluate: async () => {
            const health = await readSandboxHealthz({
              fixture,
              authenticatedSession,
              sandboxInstanceId,
            }).catch(() => null);
            if (health === null) {
              return null;
            }

            const codexProxy = requireHealthComponent(health, "codex_proxy");
            const codexAppServer = requireHealthComponent(health, "codex_app_server");
            if (codexProxy.state !== "healthy" || codexAppServer.state !== "healthy") {
              return health;
            }

            return null;
          },
        });

        const degradedCodexProxy = requireHealthComponent(degradedHealth, "codex_proxy");
        const degradedCodexAppServer = requireHealthComponent(degradedHealth, "codex_app_server");
        expect(
          degradedCodexProxy.state === "restarting" ||
            degradedCodexAppServer.state === "restarting",
        ).toBe(true);
        expect(degradedCodexAppServer.restart_count).toBeGreaterThan(0);

        const recoveredHealth = await waitForCondition({
          description: "sandboxd __healthz codex recovery",
          timeoutMs: 30_000,
          pollIntervalMs: 100,
          evaluate: async () => {
            const health = await readSandboxHealthz({
              fixture,
              authenticatedSession,
              sandboxInstanceId,
            }).catch(() => null);
            if (health === null) {
              return null;
            }

            const codexProxy = requireHealthComponent(health, "codex_proxy");
            const codexAppServer = requireHealthComponent(health, "codex_app_server");
            if (
              codexProxy.state === "healthy" &&
              codexAppServer.state === "healthy" &&
              codexAppServer.restart_count >= degradedCodexAppServer.restart_count
            ) {
              return health;
            }

            return null;
          },
        });

        expect(requireHealthComponent(recoveredHealth, "codex_proxy").state).toBe("healthy");
        expect(requireHealthComponent(recoveredHealth, "codex_app_server").state).toBe("healthy");
      } finally {
        await attachedAgentSession.close().catch(() => {});
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});
