export function formatSandboxProfileVersionLabel(version: number): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Sandbox profile version must be a positive integer. Received '${version}'.`);
  }

  return `Version ${version}`;
}
