import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

export function renderPageWithClient(input: {
  element: React.JSX.Element;
  initialEntries?: string[];
  queryClient: QueryClient;
}) {
  const routerProps =
    input.initialEntries === undefined ? {} : { initialEntries: input.initialEntries };

  return render(
    <QueryClientProvider client={input.queryClient}>
      <MemoryRouter {...routerProps}>{input.element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

export function renderPageToStaticMarkup(input: {
  element: React.JSX.Element;
  initialEntries?: string[];
  queryClient: QueryClient;
}): string {
  const routerProps =
    input.initialEntries === undefined ? {} : { initialEntries: input.initialEntries };

  return renderToStaticMarkup(
    <QueryClientProvider client={input.queryClient}>
      <MemoryRouter {...routerProps}>{input.element}</MemoryRouter>
    </QueryClientProvider>,
  );
}
