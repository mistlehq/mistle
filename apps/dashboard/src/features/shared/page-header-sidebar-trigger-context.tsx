import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type PageHeaderSidebarTriggerContextValue = {
  control: ReactNode;
  isVisible: boolean;
};

const PageHeaderSidebarTriggerContext = createContext<PageHeaderSidebarTriggerContextValue>({
  control: null,
  isVisible: false,
});

export const PageHeaderSidebarTriggerProvider = PageHeaderSidebarTriggerContext.Provider;

export function usePageHeaderSidebarTrigger(): PageHeaderSidebarTriggerContextValue {
  return useContext(PageHeaderSidebarTriggerContext);
}
