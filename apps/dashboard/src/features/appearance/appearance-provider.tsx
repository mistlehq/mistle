import { createContext, useContext, useEffect, useState } from "react";

import {
  resolveAppearance,
  type ResolvedAppearance,
  type UserAppearance,
  UserAppearances,
} from "./appearance.js";

const ColorSchemeMediaQuery = "(prefers-color-scheme: dark)";
const ResolvedAppearanceContext = createContext<ResolvedAppearance | null>(null);

function getColorSchemeMediaQueryList(): MediaQueryList {
  if (typeof window.matchMedia !== "function") {
    throw new Error("window.matchMedia is required to resolve system appearance.");
  }

  return window.matchMedia(ColorSchemeMediaQuery);
}

export function applyResolvedAppearance(resolvedAppearance: ResolvedAppearance): void {
  document.documentElement.classList.toggle("dark", resolvedAppearance === "dark");
  document.documentElement.style.colorScheme = resolvedAppearance;
}

export function useResolvedAppearance(): ResolvedAppearance {
  const resolvedAppearance = useContext(ResolvedAppearanceContext);
  if (resolvedAppearance === null) {
    throw new Error("Resolved appearance context is required.");
  }

  return resolvedAppearance;
}

export function ResolvedAppearanceProvider(input: {
  children: React.ReactNode;
  resolvedAppearance: ResolvedAppearance;
}): React.JSX.Element {
  return (
    <ResolvedAppearanceContext.Provider value={input.resolvedAppearance}>
      {input.children}
    </ResolvedAppearanceContext.Provider>
  );
}

export function AppearanceProvider(input: {
  appearance: UserAppearance;
  children: React.ReactNode;
}): React.JSX.Element {
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => getColorSchemeMediaQueryList().matches,
  );

  useEffect(() => {
    const mediaQuery = getColorSchemeMediaQueryList();
    const handleColorSchemeChange = () => {
      setSystemPrefersDark(mediaQuery.matches);
    };

    handleColorSchemeChange();
    mediaQuery.addEventListener("change", handleColorSchemeChange);
    return () => {
      mediaQuery.removeEventListener("change", handleColorSchemeChange);
    };
  }, []);

  const resolvedAppearance = resolveAppearance({
    appearance: input.appearance,
    systemPrefersDark,
  });

  useEffect(() => {
    applyResolvedAppearance(resolvedAppearance);
  }, [resolvedAppearance]);

  return (
    <ResolvedAppearanceProvider resolvedAppearance={resolvedAppearance}>
      {input.children}
    </ResolvedAppearanceProvider>
  );
}

export function SystemAppearanceProvider(input: { children: React.ReactNode }): React.JSX.Element {
  return (
    <AppearanceProvider appearance={UserAppearances.SYSTEM}>{input.children}</AppearanceProvider>
  );
}
