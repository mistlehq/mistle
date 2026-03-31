import { z } from "zod";

import { AwsRegionIdSet, AwsServiceIdSet } from "./endpoint-catalog.js";

const AwsBindingEntrySchema = z.string().trim().min(1);

export const AwsBindingConfigSchema = z
  .object({
    services: z.array(AwsBindingEntrySchema).min(1),
    regions: z.array(AwsBindingEntrySchema).min(1),
    defaultRegion: AwsBindingEntrySchema,
  })
  .superRefine((value, ctx) => {
    for (const [index, serviceId] of value.services.entries()) {
      if (AwsServiceIdSet.has(serviceId)) {
        continue;
      }

      ctx.addIssue({
        code: "custom",
        message: `Unsupported AWS service '${serviceId}'.`,
        path: ["services", index],
      });
    }

    for (const [index, regionId] of value.regions.entries()) {
      if (AwsRegionIdSet.has(regionId)) {
        continue;
      }

      ctx.addIssue({
        code: "custom",
        message: `Unsupported AWS region '${regionId}'.`,
        path: ["regions", index],
      });
    }

    if (value.regions.includes(value.defaultRegion)) {
      if (AwsRegionIdSet.has(value.defaultRegion)) {
        return;
      }

      ctx.addIssue({
        code: "custom",
        message: `Unsupported AWS region '${value.defaultRegion}'.`,
        path: ["defaultRegion"],
      });
      return;
    }

    ctx.addIssue({
      code: "custom",
      message: "Default region must be one of the selected regions.",
      path: ["defaultRegion"],
    });
  });

export type AwsBindingConfig = z.output<typeof AwsBindingConfigSchema>;
