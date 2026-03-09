import { useState } from "react";
import { Outlet } from "react-router";

import { useAppPageMeta } from "../navigation/route-meta.js";
import { SettingsHeaderActionsContext } from "./settings-header-actions.js";
import { SettingsLayoutView } from "./settings-layout-view.js";

export function SettingsLayout(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const [headerActions, setHeaderActions] = useState<React.ReactNode | null>(null);
  const title = pageMeta.title ?? "Settings";
  const description = pageMeta.description ?? "Manage account and organization settings.";
  const shouldShowDescription = description.trim().length > 0;

  return (
    <SettingsHeaderActionsContext.Provider value={setHeaderActions}>
      <SettingsLayoutView
        description={shouldShowDescription ? description : ""}
        headerActions={headerActions}
        title={title}
      >
        <Outlet />
      </SettingsLayoutView>
    </SettingsHeaderActionsContext.Provider>
  );
}
