export function resolvePresignedImageExpiresAt(input: {
  now: Date;
  expiresInSeconds: number;
}): string {
  return new Date(input.now.getTime() + input.expiresInSeconds * 1000).toISOString();
}
