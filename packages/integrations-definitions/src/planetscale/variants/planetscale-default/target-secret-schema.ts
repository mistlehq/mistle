import { z } from "zod";

export const PlanetScaleTargetSecretSchema = z
  .object({
    client_secret: z.string().min(1),
  })
  .strict();

export type PlanetScaleTargetSecrets = z.output<typeof PlanetScaleTargetSecretSchema>;
