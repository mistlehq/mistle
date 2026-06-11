const AssociatedResourceDeliveryRuntimeIds = new Set(["codex", "opencode", "pi"]);

export function supportsAssociatedResourceDeliveryRuntime(runtimeId: string): boolean {
  return AssociatedResourceDeliveryRuntimeIds.has(runtimeId);
}
