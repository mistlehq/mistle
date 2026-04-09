import { z } from "zod";

import {
  isAwsSupportedRegionId,
  resolveAwsEndpointServiceDefinition,
} from "../../shared/endpoint-catalog.js";
import { AwsToolIds } from "./tool-ids.js";

const AwsBindingToolSchema = z.enum([AwsToolIds.AWS_CLI]);

export const AwsBindingConfigSchema = z
  .object({
    services: z.array(z.string().trim().min(1)).min(1),
    regions: z.array(z.string().trim().min(1)).min(1),
    defaultRegion: z.string().trim().min(1),
    tools: z.array(AwsBindingToolSchema).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [index, serviceId] of value.services.entries()) {
      if (resolveAwsEndpointServiceDefinition(serviceId) !== undefined) {
        continue;
      }

      ctx.addIssue({
        code: "custom",
        message: `Unsupported AWS service id '${serviceId}'.`,
        path: ["services", index],
      });
    }

    for (const [index, region] of value.regions.entries()) {
      if (isAwsSupportedRegionId(region)) {
        continue;
      }

      ctx.addIssue({
        code: "custom",
        message: `Unsupported AWS region '${region}'.`,
        path: ["regions", index],
      });
    }

    if (!value.regions.includes(value.defaultRegion)) {
      ctx.addIssue({
        code: "custom",
        message: "Default region must be included in the selected regions.",
        path: ["defaultRegion"],
      });
    }
  });

export type AwsBindingConfig = z.output<typeof AwsBindingConfigSchema>;
