export function buildBasicAuthorizationHeader(input: {
  username: string;
  password: string;
}): string {
  return `Basic ${Buffer.from(`${input.username}:${input.password}`, "utf8").toString("base64")}`;
}
