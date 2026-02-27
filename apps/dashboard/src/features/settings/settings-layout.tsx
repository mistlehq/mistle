import { useState } from "react";
import { Outlet } from "react-router";

import { useAppPageMeta } from "../navigation/route-meta.js";
import { SettingsHeaderActionsContext } from "./settings-header-actions.js";

export function SettingsLayout(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const [headerActions, setHeaderActions] = useState<React.ReactNode | null>(null);
  const title = pageMeta.title ?? "Settings";
  const description = pageMeta.description ?? "Manage account and organization settings.";
  const shouldShowDescription = description.trim().length > 0;

  return (
    <SettingsHeaderActionsContext.Provider value={setHeaderActions}>
      <div className="gap-4 flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="gap-1 flex flex-col">
            <h1 className="text-xl font-semibold">{title}</h1>
            {shouldShowDescription ? (
              <p className="text-muted-foreground text-sm">{description}</p>
            ) : null}
          </div>
          {headerActions ? <div className="shrink-0">{headerActions}</div> : null}
        </div>
        <Outlet />
      </div>
    </SettingsHeaderActionsContext.Provider>
  );
}
