import { connect } from "@nats-io/transport-node";
import { describe, expect, test } from "vitest";

import { startNats } from "../src/index.js";

describe("NATS service integration", () => {
  test("starts NATS and supports a client publish subscribe round trip", async () => {
    const natsService = await startNats();
    const connection = await connect({
      servers: natsService.url,
    });

    try {
      const subject = "test-harness.nats.round-trip";
      const subscription = connection.subscribe(subject, {
        max: 1,
      });

      connection.publish(subject, "reachable");

      const messages: string[] = [];
      for await (const message of subscription) {
        messages.push(new TextDecoder().decode(message.data));
      }

      expect(messages).toEqual(["reachable"]);
    } finally {
      await connection.close();
      await natsService.stop();
    }
  }, 30_000);

  test("throws when stopping the same service twice", async () => {
    const natsService = await startNats();
    await natsService.stop();

    await expect(natsService.stop()).rejects.toThrow("NATS container was already stopped.");
  }, 30_000);
});
