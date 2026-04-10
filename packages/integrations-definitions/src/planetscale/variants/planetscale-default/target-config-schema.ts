import { z } from "zod";

export const PlanetScaleTargetConfigSchema = z
  .object({
    client_id: z.string().min(1),
  })
  .strict();

export type PlanetScaleTargetConfig = z.output<typeof PlanetScaleTargetConfigSchema>;
