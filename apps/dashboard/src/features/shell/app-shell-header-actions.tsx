import { createContext, useContext, useEffect } from "react";

type AppShellHeaderActionsSetter = (actions: React.ReactNode | null) => void;

export const AppShellHeaderActionsContext = createContext<AppShellHeaderActionsSetter | null>(null);

export function useAppShellHeaderActions(actions: React.ReactNode | null): void {
  const setHeaderActions = useContext(AppShellHeaderActionsContext);

  if (setHeaderActions === null) {
    throw new Error("useAppShellHeaderActions must be used within AppShell.");
  }

  useEffect(() => {
    setHeaderActions(actions);
    return () => {
      setHeaderActions(null);
    };
  }, [actions, setHeaderActions]);
}
