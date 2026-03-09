import { useLocation } from "react-router";

import { SettingsSectionNavView } from "./settings-section-nav-view.js";

export function SettingsSectionNav(): React.JSX.Element {
  const location = useLocation();

  return <SettingsSectionNavView pathname={location.pathname} />;
}
