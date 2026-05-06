import { createContext, useContext } from "react";
import type { ReactNode } from "react";

const PageHeaderSidebarTriggerContext = createContext<ReactNode>(null);

export const PageHeaderSidebarTriggerProvider = PageHeaderSidebarTriggerContext.Provider;

export function usePageHeaderSidebarTrigger(): ReactNode {
  return useContext(PageHeaderSidebarTriggerContext);
}
