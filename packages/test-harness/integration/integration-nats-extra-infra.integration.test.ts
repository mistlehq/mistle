/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { connect } from "@nats-io/transport-node";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: [],
  extraInfra: ["nats"],
});

describe.concurrent("integration NATS extra infra", () => {
  it("exposes a reachable NATS endpoint on the integration environment", async ({ env }) => {
    const connection = await connect({
      servers: env.nats.url,
    });

    try {
      const subject = `${env.id}.nats.extra-infra`;
      const subscription = connection.subscribe(subject, {
        max: 1,
      });

      connection.publish(subject, "ready");

      const messages: string[] = [];
      for await (const message of subscription) {
        messages.push(new TextDecoder().decode(message.data));
      }

      expect(messages).toEqual(["ready"]);
    } finally {
      await connection.close();
    }
  }, 30_000);
});
