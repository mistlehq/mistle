import { systemSleeper } from "@mistle/time";
import { QueryClient } from "@tanstack/react-query";

const ActiveQueryClients = new Set<QueryClient>();

export function createTestQueryClient(input?: {
  gcTime?: number;
  refetchOnMount?: boolean;
  retry?: boolean;
  retryOnMount?: boolean;
  staleTime?: number;
}): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        ...(input?.gcTime === undefined ? {} : { gcTime: input.gcTime }),
        ...(input?.refetchOnMount === undefined ? {} : { refetchOnMount: input.refetchOnMount }),
        retry: input?.retry ?? false,
        ...(input?.retryOnMount === undefined ? {} : { retryOnMount: input.retryOnMount }),
        ...(input?.staleTime === undefined ? {} : { staleTime: input.staleTime }),
      },
    },
  });

  ActiveQueryClients.add(queryClient);
  return queryClient;
}

export async function cleanupTestQueryClients(): Promise<boolean> {
  if (ActiveQueryClients.size === 0) {
    return false;
  }

  await Promise.all(
    [...ActiveQueryClients].map(async (queryClient) => {
      await queryClient.cancelQueries();
      queryClient.clear();
    }),
  );

  ActiveQueryClients.clear();
  return true;
}

export async function flushScheduledReactWork(): Promise<void> {
  await systemSleeper.sleep(0);
}
