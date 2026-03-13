import { useState } from "react";
import { Outlet } from "react-router";

import { useAppPageMeta } from "../navigation/route-meta.js";
import { SettingsHeaderActionsContext } from "./settings-header-actions.js";
import { SettingsLayoutView } from "./settings-layout-view.js";

export function SettingsLayout(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const [headerActions, setHeaderActions] = useState<React.ReactNode | null>(null);
  const title = pageMeta.title ?? "Settings";
  const supportingText = pageMeta.supportingText ?? "Manage account and organization settings.";
  const shouldShowSupportingText = supportingText.trim().length > 0;

  return (
    <SettingsHeaderActionsContext.Provider value={setHeaderActions}>
      <SettingsLayoutView
        supportingText={shouldShowSupportingText ? supportingText : ""}
        headerActions={headerActions}
        headerIcon={pageMeta.headerIcon}
        title={title}
      >
        <Outlet />
      </SettingsLayoutView>
    </SettingsHeaderActionsContext.Provider>
  );
}
