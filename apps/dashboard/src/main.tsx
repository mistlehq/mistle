import { Toaster } from "@mistle/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import { AnalyticsProvider } from "./lib/analytics/provider.js";

import "./index.css";

const rootElement = document.getElementById("root");
const queryClient = new QueryClient();

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AnalyticsProvider>
        <App />
        <Toaster position="top-right" />
      </AnalyticsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
