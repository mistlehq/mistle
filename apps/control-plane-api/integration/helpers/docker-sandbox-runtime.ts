import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function startDockerSandboxContainer(): Promise<string> {
  const { stdout } = await execFileAsync("docker", ["run", "-d", "registry:3"]);
  const containerId = stdout.trim();
  if (containerId.length === 0) {
    throw new Error("Expected docker run to return a container id.");
  }

  return containerId;
}

export async function stopDockerSandboxContainer(containerId: string): Promise<void> {
  await execFileAsync("docker", ["stop", containerId]);
}

export async function resumeDockerSandboxContainer(containerId: string): Promise<void> {
  await execFileAsync("docker", ["start", containerId]);
}

export async function destroyDockerSandboxContainer(containerId: string): Promise<void> {
  await execFileAsync("docker", ["rm", "-f", containerId]).catch(() => undefined);
}
