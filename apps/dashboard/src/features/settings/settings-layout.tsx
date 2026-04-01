import { useState } from "react";
import { Outlet } from "react-router";

import { useAppPageMeta } from "../navigation/route-meta.js";
import { FormPageHeader } from "../shared/form-page.js";
import { SettingsHeaderActionsContext } from "./settings-header-actions.js";

export function SettingsLayout(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const [headerActions, setHeaderActions] = useState<React.ReactNode | null>(null);
  const title = pageMeta.title ?? "Settings";
  const supportingText = pageMeta.supportingText ?? "Manage account and organization settings.";
  const description = supportingText.trim().length > 0 ? supportingText : undefined;
  const isFormLayout = pageMeta.settingsLayoutVariant === "form";

  return (
    <SettingsHeaderActionsContext.Provider value={setHeaderActions}>
      <div
        className={
          isFormLayout
            ? "flex min-h-full flex-col gap-3 bg-muted/30 px-4 py-6"
            : "flex min-h-full flex-col gap-4 px-4 py-6"
        }
      >
        <div className={isFormLayout ? "mx-auto w-full max-w-2xl" : undefined}>
          <FormPageHeader
            actions={headerActions}
            description={description}
            icon={pageMeta.headerIcon}
            title={title}
          />
        </div>
        <Outlet />
      </div>
    </SettingsHeaderActionsContext.Provider>
  );
}
