import { TestContainers } from "testcontainers";

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Expected a valid TCP port number, received ${String(port)}.`);
  }
}

export async function exposeHostPorts(...ports: number[]): Promise<void> {
  if (ports.length === 0) {
    throw new Error("exposeHostPorts requires at least one port.");
  }

  for (const port of ports) {
    validatePort(port);
  }

  await TestContainers.exposeHostPorts(...ports);
}
