export function formatCompactSandboxProfileVersion(version: number): string {
  return `v${String(version)}`;
}

export function formatSandboxProfileVersionLabel(version: number): string {
  return `Version ${String(version)}`;
}

export function formatPublishedSandboxProfileVersionBadge(version: number): string {
  return `Published ${formatCompactSandboxProfileVersion(version)}`;
}
