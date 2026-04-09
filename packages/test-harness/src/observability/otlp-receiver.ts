import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { dirname } from "node:path";

export type CapturedOtlpRequest = {
  body: string;
  path: string;
};

export type StartOtlpReceiverInput = {
  captureFilePath?: string;
  host?: string;
  port?: number;
};

export type OtlpReceiver = {
  captureFilePath: string | null;
  close: () => Promise<void>;
  port: number;
  requests: CapturedOtlpRequest[];
  url: string;
};

async function appendCapturedRequestToFile(input: {
  captureFilePath: string;
  request: CapturedOtlpRequest;
}): Promise<void> {
  await writeFile(input.captureFilePath, `${JSON.stringify(input.request)}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}

export async function readCapturedOtlpRequests(
  captureFilePath: string,
): Promise<CapturedOtlpRequest[]> {
  const content = await readFile(captureFilePath, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  });

  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CapturedOtlpRequest);
}

export async function startOtlpReceiver(input: StartOtlpReceiverInput = {}): Promise<OtlpReceiver> {
  const requests: CapturedOtlpRequest[] = [];
  const sockets = new Set<Socket>();

  if (input.captureFilePath !== undefined) {
    await mkdir(dirname(input.captureFilePath), { recursive: true });
    await writeFile(input.captureFilePath, "", "utf8");
  }

  const server = createServer((request, response) => {
    const chunks: Uint8Array[] = [];

    request.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const capturedRequest: CapturedOtlpRequest = {
        body: Buffer.concat(chunks).toString("utf8"),
        path: request.url ?? "/",
      };

      requests.push(capturedRequest);
      void (input.captureFilePath === undefined
        ? Promise.resolve()
        : appendCapturedRequestToFile({
            captureFilePath: input.captureFilePath,
            request: capturedRequest,
          }));

      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end("{}");
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  server.listen(input.port ?? 0, input.host ?? "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected OTLP receiver to bind a TCP port.");
  }

  return {
    captureFilePath: input.captureFilePath ?? null,
    requests,
    port: address.port,
    url: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close();
      await once(server, "close");
    },
  };
}
