import { z } from "zod";

import { requestControlPlane } from "../api/request-control-plane.js";

export const AuthMethodsResponseSchema = z
  .object({
    methods: z
      .object({
        emailOtp: z.literal(true),
        google: z.boolean(),
      })
      .strict(),
    allowSignups: z.boolean(),
  })
  .strict();

export type AuthMethodsResponse = z.infer<typeof AuthMethodsResponseSchema>;

export async function getAuthMethods(input?: {
  signal?: AbortSignal;
}): Promise<AuthMethodsResponse> {
  const response = await requestControlPlane({
    operation: "getAuthMethods",
    method: "GET",
    pathname: "/v1/auth/methods",
    ...(input?.signal === undefined ? {} : { signal: input.signal }),
    fallbackMessage: "Could not load auth methods.",
  });

  const responseBody = await response.json().catch((): unknown => null);
  const parsedResponse = AuthMethodsResponseSchema.safeParse(responseBody);
  if (!parsedResponse.success) {
    throw new Error("Auth methods response payload is invalid.");
  }

  return parsedResponse.data;
}
