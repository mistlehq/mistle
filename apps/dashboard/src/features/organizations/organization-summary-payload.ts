import { z } from "zod";

export type OrganizationSummary = {
  name: string;
};

const OrganizationSummarySchema = z.object({
  name: z.string(),
});

export function parseOrganizationSummary(value: unknown): OrganizationSummary {
  const parsedOrganization = OrganizationSummarySchema.safeParse(value);
  if (!parsedOrganization.success) {
    throw new Error("Organization name was missing.");
  }

  return {
    name: parsedOrganization.data.name,
  };
}
