export function formatConnectionCount(count: number): string {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Connection count must be a non-negative integer. Received '${count}'.`);
  }

  if (count === 1) {
    return "1 connection";
  }

  return `${count} connections`;
}
