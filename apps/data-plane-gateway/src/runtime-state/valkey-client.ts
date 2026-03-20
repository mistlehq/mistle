import { createClient } from "redis";

import { logger } from "../logger.js";

/**
 * Shared node-redis client type used by gateway runtime-state adapters.
 */
export type ValkeyClient = ReturnType<typeof createClient>;

/**
 * Creates a Valkey client for gateway runtime-state storage.
 */
export function createValkeyClient(input: { url: string }): ValkeyClient {
  const client = createClient({
    url: input.url,
  });

  client.on("error", (error: unknown) => {
    logger.error(
      {
        err: error,
      },
      "Valkey runtime-state client error",
    );
  });

  return client;
}

/**
 * Opens the Valkey client connection before the gateway starts serving traffic.
 */
export async function connectValkeyClient(client: ValkeyClient): Promise<void> {
  if (client.isOpen) {
    return;
  }

  await client.connect();
}

/**
 * Closes the Valkey client connection during gateway shutdown.
 */
export async function closeValkeyClient(client: ValkeyClient): Promise<void> {
  if (!client.isOpen) {
    return;
  }

  await client.close();
}
