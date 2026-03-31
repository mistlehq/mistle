import { z } from "zod";

const AwsBindingEntrySchema = z.string().trim().min(1);

export const AwsBindingConfigSchema = z
  .object({
    services: z.array(AwsBindingEntrySchema).min(1),
    regions: z.array(AwsBindingEntrySchema).min(1),
    defaultRegion: AwsBindingEntrySchema,
  })
  .superRefine((value, ctx) => {
    if (value.regions.includes(value.defaultRegion)) {
      return;
    }

    ctx.addIssue({
      code: "custom",
      message: "Default region must be one of the selected regions.",
      path: ["defaultRegion"],
    });
  });

export type AwsBindingConfig = z.output<typeof AwsBindingConfigSchema>;
