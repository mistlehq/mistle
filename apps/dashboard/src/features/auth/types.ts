import type { authClient } from "../../lib/auth/client.js";

export type AuthClientError = {
  message?: string | undefined;
} | null;

export type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];
