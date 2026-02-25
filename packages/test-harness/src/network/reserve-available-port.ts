import { createServer } from "node:net";

export async function reserveAvailablePort(input: { host: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, input.host, () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        reject(new Error("Failed to resolve an ephemeral TCP port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}
