import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { APP_ROUTES } from "../../app.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxInstancesListResult } from "../sessions/sessions-types.js";
import { readBrowserStorageItem, writeBrowserStorageItem } from "../shared/browser-storage.js";
import { SESSIONS_SIDEBAR_MODE_STORAGE_KEY } from "../shell/app-shell.js";
import { createSessionsPageStoryQueryClient } from "./sessions-page.story-fixtures.js";

type SessionsStoryHarnessProps = {
  initialEntries: readonly string[];
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  sandboxInstancesList?: SandboxInstancesListResult;
  showSessionsSidebar?: boolean;
};

export function SessionsStoryHarness(input: SessionsStoryHarnessProps): React.JSX.Element {
  const [previousSessionsSidebarPreference] = useState(() => {
    const storage = window.localStorage;
    const previousValue = readBrowserStorageItem({
      key: SESSIONS_SIDEBAR_MODE_STORAGE_KEY,
      storage,
    });

    writeBrowserStorageItem({
      key: SESSIONS_SIDEBAR_MODE_STORAGE_KEY,
      value: input.showSessionsSidebar === false ? "false" : "true",
      storage,
    });

    return previousValue;
  });
  const [queryClient] = useState(() =>
    createSessionsPageStoryQueryClient({
      ...(input.launchableProfiles !== undefined
        ? { launchableProfiles: input.launchableProfiles }
        : {}),
      ...(input.sandboxInstancesList !== undefined
        ? { sandboxInstancesList: input.sandboxInstancesList }
        : {}),
    }),
  );
  const [router] = useState(() =>
    createMemoryRouter(APP_ROUTES, {
      initialEntries: [...input.initialEntries],
    }),
  );

  useEffect(() => {
    return () => {
      if (previousSessionsSidebarPreference === null) {
        window.localStorage.removeItem(SESSIONS_SIDEBAR_MODE_STORAGE_KEY);
        return;
      }

      writeBrowserStorageItem({
        key: SESSIONS_SIDEBAR_MODE_STORAGE_KEY,
        value: previousSessionsSidebarPreference,
        storage: window.localStorage,
      });
    };
  }, [previousSessionsSidebarPreference]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
