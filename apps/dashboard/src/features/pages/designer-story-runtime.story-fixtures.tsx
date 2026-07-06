import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { MemoryRouter } from "react-router";

export function DesignerStoryRuntime(input: {
  children: ReactNode;
  queryClient?: QueryClient | undefined;
}): React.JSX.Element {
  const [ownedQueryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={input.queryClient ?? ownedQueryClient}>
      <MemoryRouter>{input.children}</MemoryRouter>
    </QueryClientProvider>
  );
}
