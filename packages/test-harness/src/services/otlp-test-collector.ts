import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";

export type CapturedOtlpRequest = {
  body: string;
  path: string;
};

export type OtlpTestCollector = {
  id: string;
  baseUrl: string;
  clear: () => void;
  endpointForPath: (path: string) => string;
  requests: readonly CapturedOtlpRequest[];
  stop: () => Promise<void>;
};

const collectorsById = new Map<string, OtlpTestCollector>();

export async function startOtlpTestCollector(): Promise<OtlpTestCollector> {
  const requests: CapturedOtlpRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Uint8Array[] = [];

    request.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      requests.push({
        body: Buffer.concat(chunks).toString("utf8"),
        path: request.url ?? "/",
      });
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end("{}");
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Expected OTLP test collector to bind an ephemeral TCP port.");
  }

  const id = `otlp_${randomUUID()}`;
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;
  const collector: OtlpTestCollector = {
    id,
    baseUrl,
    requests,
    clear: () => {
      requests.length = 0;
    },
    endpointForPath: (path) => new URL(path, baseUrl).toString(),
    stop: async () => {
      collectorsById.delete(id);
      await closeServer(server);
    },
  };

  collectorsById.set(id, collector);

  return collector;
}

export function readOtlpTestCollector(id: string): OtlpTestCollector {
  const collector = collectorsById.get(id);
  if (collector === undefined) {
    throw new Error(`Expected OTLP test collector '${id}' to be active.`);
  }

  return collector;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  server.close();
  await once(server, "close");
}
