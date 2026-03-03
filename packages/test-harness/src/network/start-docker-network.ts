import { Network, type StartedNetwork } from "testcontainers";

export async function startDockerNetwork(): Promise<StartedNetwork> {
  return new Network().start();
}
