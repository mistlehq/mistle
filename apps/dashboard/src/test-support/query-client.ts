import { QueryClient } from "@tanstack/react-query";

export function createTestQueryClient(input?: {
  gcTime?: number;
  refetchOnMount?: boolean;
  retry?: boolean;
  staleTime?: number;
}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        ...(input?.gcTime === undefined ? {} : { gcTime: input.gcTime }),
        ...(input?.refetchOnMount === undefined ? {} : { refetchOnMount: input.refetchOnMount }),
        retry: input?.retry ?? false,
        ...(input?.staleTime === undefined ? {} : { staleTime: input.staleTime }),
      },
    },
  });
}
