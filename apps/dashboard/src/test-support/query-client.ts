import { systemSleeper } from "@mistle/time";
import { QueryClient } from "@tanstack/react-query";

const ActiveQueryClients = new Set<QueryClient>();

export function createTestQueryClient(input?: {
  gcTime?: number;
  refetchOnMount?: boolean;
  retry?: boolean;
  staleTime?: number;
}): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        ...(input?.gcTime === undefined ? {} : { gcTime: input.gcTime }),
        ...(input?.refetchOnMount === undefined ? {} : { refetchOnMount: input.refetchOnMount }),
        retry: input?.retry ?? false,
        ...(input?.staleTime === undefined ? {} : { staleTime: input.staleTime }),
      },
    },
  });

  ActiveQueryClients.add(queryClient);
  return queryClient;
}

export async function cleanupTestQueryClients(): Promise<void> {
  await Promise.all(
    [...ActiveQueryClients].map(async (queryClient) => {
      await queryClient.cancelQueries();
      queryClient.clear();
    }),
  );

  ActiveQueryClients.clear();
}

export async function flushScheduledReactWork(): Promise<void> {
  await systemSleeper.sleep(0);
}
