import { createClient, type RedisClientType } from "redis";

/**
 * RESP2 wire protocol. redis@6 defaults to RESP3, which changes reply shapes
 * for null, integer, and array replies. Pin RESP2 here so a dependency bump
 * does not silently flip the wire protocol our runtime code was written
 * against; adopting RESP3 should be a deliberate, separately validated change.
 */
type ValkeyRespVersion = 2;
type ValkeyModules = Record<string, never>;
type ValkeyFunctions = Record<string, never>;
type ValkeyScripts = Record<string, never>;
type ValkeyTypeMapping = {};

export type ValkeyClient = RedisClientType<
  ValkeyModules,
  ValkeyFunctions,
  ValkeyScripts,
  ValkeyRespVersion,
  ValkeyTypeMapping
>;

export function createValkeyClient(input: {
  onError?: (error: unknown) => void;
  url: string;
}): ValkeyClient {
  const client = createClient<
    ValkeyModules,
    ValkeyFunctions,
    ValkeyScripts,
    ValkeyRespVersion,
    ValkeyTypeMapping
  >({
    RESP: 2,
    url: input.url,
  });

  client.on("error", (error: unknown) => {
    input.onError?.(error);
  });

  return client;
}

export async function connectValkeyClient(client: ValkeyClient): Promise<void> {
  if (client.isOpen) {
    return;
  }

  await client.connect();
}

export async function closeValkeyClient(client: ValkeyClient): Promise<void> {
  if (!client.isOpen) {
    return;
  }

  await client.close();
}
