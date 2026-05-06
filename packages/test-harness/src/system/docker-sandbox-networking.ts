export function createDockerSandboxReachableHostUrl(value: string): string {
  const url = new URL(value);
  url.hostname = "host.docker.internal";
  return url.toString().replace(/\/$/u, "");
}
