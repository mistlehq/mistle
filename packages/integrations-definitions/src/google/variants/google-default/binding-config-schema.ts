import { z } from "zod";

import { GoogleCapabilityCatalog } from "./capabilities/catalog.js";

const GoogleCapabilityIds = new Set(GoogleCapabilityCatalog.map((capability) => capability.id));

export const GoogleCapabilityIdSchema = z.string().superRefine((value, ctx) => {
  if (!GoogleCapabilityIds.has(value)) {
    ctx.addIssue({
      code: "custom",
      message: `Unsupported Google capability id '${value}'.`,
    });
  }
});

export const GoogleBindingConfigSchema = z
  .object({
    capabilities: z
      .array(GoogleCapabilityIdSchema)
      .default([])
      .superRefine((capabilities, ctx) => {
        const seenCapabilities = new Set<string>();

        for (const [index, capability] of capabilities.entries()) {
          if (seenCapabilities.has(capability)) {
            ctx.addIssue({
              code: "custom",
              message: `Duplicate Google capability id '${capability}'.`,
              path: [index],
            });
          }
          seenCapabilities.add(capability);
        }
      }),
  })
  .strict();

export type GoogleBindingConfig = z.output<typeof GoogleBindingConfigSchema>;
