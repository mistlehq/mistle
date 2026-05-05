import { z } from "zod";

const AwsUrlSchema = z.url().transform((input) => {
  const parsedUrl = new URL(input);
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return parsedUrl.toString().replace(/\/$/u, "");
});

export const AwsTargetConfigSchema = z
  .object({
    sts_endpoint_url: AwsUrlSchema.optional(),
  })
  .strict()
  .transform((input) =>
    input.sts_endpoint_url === undefined ? {} : { stsEndpointUrl: input.sts_endpoint_url },
  );

export type AwsTargetConfig = z.output<typeof AwsTargetConfigSchema>;
