/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import { createMutableClock } from "@mistle/time/testing";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import { describe, expect } from "vitest";

import { GatewayForwardingReadiness } from "../src/runtime/gateway-forwarding-readiness.js";
import { LocalGatewayForwardingServerAdapter } from "../src/tunnel/gateway-forwarding/adapters/local-gateway-forwarding-server-adapter.js";
import { NatsGatewayForwardingAdapter } from "../src/tunnel/gateway-forwarding/adapters/nats-gateway-forwarding-adapter.js";
import { InMemoryTunnelSessionRegistryAdapter } from "../src/tunnel/tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../src/tunnel/tunnel-session/index.js";

const ReadinessStateTimeoutMs = 5_000;
const ReadinessStatePollIntervalMs = 20;

const natsIt = createIntegrationTest({
  services: [],
  extraInfra: ["nats"],
});

describe("NatsGatewayForwardingAdapter", () => {
  natsIt(
    "marks forwarding ready before startup resolves",
    async ({ env }) => {
      let relayConnection: NatsConnection | undefined;
      let readinessCheckConnection: NatsConnection | undefined;
      let adapter: NatsGatewayForwardingAdapter | undefined;

      try {
        relayConnection = await connect({
          servers: env.nats.url,
        });
        readinessCheckConnection = await connect({
          servers: env.nats.url,
        });

        const subjectPrefix = "integration.gateway-forwarding-startup";
        const nodeId = "gateway-a";
        const readiness = new GatewayForwardingReadiness({
          backend: "nats",
          clock: createMutableClock(1_000),
          localNodeId: nodeId,
          subject: `${subjectPrefix}.forward.${nodeId}`,
        });
        adapter = new NatsGatewayForwardingAdapter(
          nodeId,
          subjectPrefix,
          new LocalGatewayForwardingServerAdapter(
            new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter()),
          ),
          readiness,
        );

        await adapter.start(relayConnection, readinessCheckConnection);

        expect(readiness.getState()).toEqual({
          changedAtMs: 1_000,
          lastCheckAtMs: 1_000,
          reason: "self_check_succeeded",
          status: "ready",
        });
      } finally {
        await adapter?.stop();
        await relayConnection?.close();
        await readinessCheckConnection?.close();
      }
    },
    30_000,
  );

  natsIt(
    "marks forwarding not ready when the subscription loop exits",
    async ({ env }) => {
      let relayConnection: NatsConnection | undefined;
      let readinessCheckConnection: NatsConnection | undefined;
      let adapter: NatsGatewayForwardingAdapter | undefined;
      let adapterNeedsStop = true;

      try {
        relayConnection = await connect({
          servers: env.nats.url,
        });
        readinessCheckConnection = await connect({
          servers: env.nats.url,
        });

        const clock = createMutableClock(1_000);
        const subjectPrefix = "integration.gateway-forwarding-subscription-exit";
        const nodeId = "gateway-a";
        const readiness = new GatewayForwardingReadiness({
          backend: "nats",
          clock,
          localNodeId: nodeId,
          subject: `${subjectPrefix}.forward.${nodeId}`,
        });
        adapter = new NatsGatewayForwardingAdapter(
          nodeId,
          subjectPrefix,
          new LocalGatewayForwardingServerAdapter(
            new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter()),
          ),
          readiness,
        );
        await adapter.start(relayConnection, readinessCheckConnection);

        clock.advanceMs(100);
        await relayConnection.close();
        adapterNeedsStop = false;

        await waitForReadinessStatus(readiness, "not_ready");
        expect(readiness.getState()).toMatchObject({
          reason: "subscription_exited",
          status: "not_ready",
        });
      } finally {
        if (adapterNeedsStop) {
          await adapter?.stop();
        }
        await relayConnection?.close();
        await readinessCheckConnection?.close();
      }
    },
    30_000,
  );
});

async function waitForReadinessStatus(
  readiness: GatewayForwardingReadiness,
  status: "not_ready" | "checking" | "ready",
): Promise<void> {
  const deadlineMs = systemClock.nowMs() + ReadinessStateTimeoutMs;
  while (systemClock.nowMs() < deadlineMs) {
    if (readiness.getState().status === status) {
      return;
    }
    await systemSleeper.sleep(ReadinessStatePollIntervalMs);
  }

  throw new Error(`Timed out waiting for gateway forwarding readiness status '${status}'.`);
}
