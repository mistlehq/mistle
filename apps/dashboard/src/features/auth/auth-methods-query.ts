import { useQuery } from "@tanstack/react-query";

import { getAuthMethods } from "./auth-methods-service.js";

export const AUTH_METHODS_QUERY_KEY: readonly ["auth", "methods"] = ["auth", "methods"];

export function useAuthMethodsQuery() {
  return useQuery({
    queryKey: AUTH_METHODS_QUERY_KEY,
    queryFn: async ({ signal }) => getAuthMethods({ signal }),
  });
}
