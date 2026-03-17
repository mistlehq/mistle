import { z } from "zod";

const RawNotionTargetSecretSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
  })
  .strict();

export const NotionTargetSecretSchema = RawNotionTargetSecretSchema.transform((rawSecrets) => ({
  clientId: rawSecrets.client_id,
  clientSecret: rawSecrets.client_secret,
}));

export type NotionTargetSecrets = z.output<typeof NotionTargetSecretSchema>;
