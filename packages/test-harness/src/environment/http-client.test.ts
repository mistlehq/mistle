import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { createTestHttpClient } from "./http-client.js";

describe("createTestHttpClient", () => {
  it("sends Node FormData as multipart form data", async () => {
    const received = await withBodyRecorder(async (baseUrl) => {
      const client = createTestHttpClient({ baseUrl });
      const formData = new FormData();
      formData.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "avatar.jpg", {
          type: "image/jpeg",
        }),
      );

      try {
        const response = await client.fetch("/upload", {
          method: "PUT",
          body: formData,
        });
        expect(response.status).toBe(204);
      } finally {
        await client.close();
      }
    });

    expect(received.contentType).toMatch(/^multipart\/form-data; boundary=/u);
    expect(received.body).toContain('name="file"; filename="avatar.jpg"');
    expect(received.body).toContain("Content-Type: image/jpeg");
  });
});

async function withBodyRecorder(
  callback: (baseUrl: string) => Promise<void>,
): Promise<{ contentType: string | undefined; body: string }> {
  let received:
    | {
        contentType: string | undefined;
        body: string;
      }
    | undefined;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      received = {
        contentType: request.headers["content-type"],
        body: Buffer.concat(chunks).toString("latin1"),
      };
      response.writeHead(204);
      response.end();
    });
  });

  try {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    await callback(`http://127.0.0.1:${String(readServerPort(server.address()))}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
          return;
        }

        reject(error);
      });
    });
  }

  if (received === undefined) {
    throw new Error("Expected test HTTP server to receive a request.");
  }

  return received;
}

function readServerPort(address: AddressInfo | string | null): number {
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected test HTTP server to listen on a TCP port.");
  }

  return address.port;
}
