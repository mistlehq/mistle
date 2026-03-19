export function resolveUserDisplayName(input: { name: string | null; email: string }): string {
  const trimmedName = input.name?.trim() ?? "";
  if (trimmedName.length === 0) {
    return input.email;
  }

  if (trimmedName === input.email) {
    return input.email;
  }

  return trimmedName;
}

export function formatUserDisplayName(input: { name: string | null; email: string }): string {
  const displayName = resolveUserDisplayName(input);
  if (displayName === input.email) {
    return input.email;
  }

  return `${displayName} (${input.email})`;
}
