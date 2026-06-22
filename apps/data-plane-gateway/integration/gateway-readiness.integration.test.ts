/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import type { TestHttpResponse, TestServiceHandle } from "@mistle/test-harness";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import { expect } from "vitest";
import { z } from "zod";

const TestTimeoutMs = 40_000;
const ReadinessPollTimeoutMs = 10_000;
const ReadinessPollIntervalMs = 50;

const GatewayReadinessBodySchema = z.looseObject({
  forwarding: z.looseObject({
    lastCheckAtMs: z.number().nullable(),
    nodeId: z.string(),
    reason: z.string(),
    status: z.string(),
    subject: z.string(),
  }),
  ok: z.boolean(),
  status: z.string(),
});

const it = createIntegrationTest({
  services: ["data-plane-gateway"],
  __dangerouslyIsolatedServices: {
    reason: "This suite intentionally mutates the data-plane gateway runtime lifecycle state.",
    services: ["data-plane-gateway"],
  },
});

const natsIt = createIntegrationTest({
  services: ["data-plane-gateway"],
  extraInfra: ["nats"],
  __dangerouslyIsolatedServices: {
    reason: "This suite forces the data-plane gateway NATS relay connection to reconnect.",
    services: ["data-plane-gateway"],
  },
  __serviceOptions: {
    dataPlaneGateway: {
      gatewayRelay: {
        backend: "nats",
        namePrefix: "mistle-integration-readiness",
      },
    },
  },
});

it(
  "keeps liveness healthy while readiness fails after gateway drain starts",
  async ({ env }) => {
    const servingHealthResponse = await env.dataPlaneGateway.http.fetch("/__healthz");
    const servingReadinessResponse = await env.dataPlaneGateway.http.fetch("/__readyz");

    expect(servingHealthResponse.status).toBe(200);
    expect(await servingHealthResponse.json()).toEqual({ ok: true });
    expect(servingReadinessResponse.status).toBe(200);
    expect(await servingReadinessResponse.json()).toMatchObject({
      ok: true,
      status: "serving",
      forwarding: {
        lastCheckAtMs: null,
        reason: "local_backend",
        status: "ready",
        subject: "memory",
      },
    });

    startGatewayDrain(env.service("data-plane-gateway"));

    const drainingHealthResponse = await env.dataPlaneGateway.http.fetch("/__healthz");
    const drainingReadinessResponse = await env.dataPlaneGateway.http.fetch("/__readyz");

    expect(drainingHealthResponse.status).toBe(200);
    expect(await drainingHealthResponse.json()).toEqual({ ok: true });
    expect(drainingReadinessResponse.status).toBe(503);
    expect(await drainingReadinessResponse.json()).toMatchObject({
      ok: false,
      status: "draining",
      reason: "service_restart",
      forwarding: {
        lastCheckAtMs: null,
        reason: "local_backend",
        status: "ready",
        subject: "memory",
      },
    });
  },
  TestTimeoutMs,
);

natsIt(
  "runs a forwarding check before returning ready after a NATS reconnect",
  async ({ env }) => {
    const initialResponse = await env.dataPlaneGateway.http.fetch("/__readyz");
    expect(initialResponse.status).toBe(200);
    const initialBody = await readGatewayReadinessBody(initialResponse);
    if (initialBody.forwarding.lastCheckAtMs === null) {
      throw new Error("Expected NATS forwarding readiness to include an initial check time.");
    }

    await forceNatsRelayReconnect(env.service("data-plane-gateway"));

    const reconnectedBody = await waitForForwardingCheckAfter({
      initialLastCheckAtMs: initialBody.forwarding.lastCheckAtMs,
      service: env.dataPlaneGateway,
    });

    expect(reconnectedBody).toMatchObject({
      ok: true,
      status: "serving",
      forwarding: {
        reason: "self_check_succeeded",
        status: "ready",
      },
    });
    expect(reconnectedBody.forwarding.lastCheckAtMs).not.toBeNull();
    if (reconnectedBody.forwarding.lastCheckAtMs === null) {
      throw new Error("Expected NATS forwarding readiness to include a reconnect check time.");
    }
    expect(reconnectedBody.forwarding.lastCheckAtMs).toBeGreaterThan(
      initialBody.forwarding.lastCheckAtMs,
    );
  },
  TestTimeoutMs,
);

function startGatewayDrain(service: TestServiceHandle): void {
  if (service.startDrain === undefined) {
    throw new Error("Expected data-plane gateway integration service to expose startDrain.");
  }

  service.startDrain();
}

async function forceNatsRelayReconnect(service: TestServiceHandle): Promise<void> {
  if (service.forceNatsRelayReconnect === undefined) {
    throw new Error("Expected data-plane gateway service to expose forceNatsRelayReconnect.");
  }

  await service.forceNatsRelayReconnect();
}

type GatewayReadinessBody = z.infer<typeof GatewayReadinessBodySchema>;

async function readGatewayReadinessBody(response: TestHttpResponse): Promise<GatewayReadinessBody> {
  return GatewayReadinessBodySchema.parse(await response.json());
}

async function waitForForwardingCheckAfter(input: {
  initialLastCheckAtMs: number;
  service: {
    http: {
      fetch: (path: string) => Promise<TestHttpResponse>;
    };
  };
}): Promise<GatewayReadinessBody> {
  const deadlineMs = systemClock.nowMs() + ReadinessPollTimeoutMs;
  while (systemClock.nowMs() < deadlineMs) {
    const response = await input.service.http.fetch("/__readyz");
    const body = await readGatewayReadinessBody(response);
    if (
      response.status === 200 &&
      body.forwarding.status === "ready" &&
      body.forwarding.lastCheckAtMs !== null &&
      body.forwarding.lastCheckAtMs > input.initialLastCheckAtMs
    ) {
      return body;
    }

    await systemSleeper.sleep(ReadinessPollIntervalMs);
  }

  throw new Error("Timed out waiting for gateway forwarding readiness after NATS reconnect.");
}
