export function clampMembersDirectoryOffset(input: {
  limit: number;
  offset: number;
  total: number;
}): number {
  if (input.total <= 0) {
    return 0;
  }

  const lastPageOffset = Math.floor((input.total - 1) / input.limit) * input.limit;
  return Math.min(input.offset, lastPageOffset);
}
