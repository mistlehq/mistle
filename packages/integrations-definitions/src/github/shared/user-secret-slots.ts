import { z } from "zod";

export const GitHubUserSecretSlots = [
  {
    key: "webhook_secret",
    label: "Webhook Secret",
    description: "Shared secret used to verify GitHub webhook deliveries.",
    valueSchema: z.string().min(1),
  },
] as const;
