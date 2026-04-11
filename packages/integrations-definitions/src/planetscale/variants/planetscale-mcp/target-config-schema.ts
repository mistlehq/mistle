import { z } from "zod";

export const PlanetScaleTargetConfigSchema = z.object({}).strict();

export type PlanetScaleTargetConfig = z.output<typeof PlanetScaleTargetConfigSchema>;
