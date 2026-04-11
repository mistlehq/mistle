import { z } from "zod";

export const PlanetScaleTargetSecretSchema = z.object({}).strict();

export type PlanetScaleTargetSecrets = z.output<typeof PlanetScaleTargetSecretSchema>;
