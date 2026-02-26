import { createContext, useContext, useEffect } from "react";

type SettingsHeaderActionsSetter = (actions: React.ReactNode | null) => void;

export const SettingsHeaderActionsContext = createContext<SettingsHeaderActionsSetter | null>(null);

export function useSettingsHeaderActions(actions: React.ReactNode | null): void {
  const setHeaderActions = useContext(SettingsHeaderActionsContext);

  if (setHeaderActions === null) {
    throw new Error("useSettingsHeaderActions must be used within SettingsLayout.");
  }

  useEffect(() => {
    setHeaderActions(actions);
    return () => {
      setHeaderActions(null);
    };
  }, [actions, setHeaderActions]);
}
