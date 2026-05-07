import { createClient } from "redis";

export type ValkeyClient = ReturnType<typeof createClient>;

export function createValkeyClient(input: {
  onError?: (error: unknown) => void;
  url: string;
}): ValkeyClient {
  const client = createClient({
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
