import type { z } from "zod";

import { GlobalConfigSchema } from "./global/schema.js";

export type AppConfig = {
  global: z.infer<typeof GlobalConfigSchema>;
};
