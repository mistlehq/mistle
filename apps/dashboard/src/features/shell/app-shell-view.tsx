import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@mistle/ui";
import { useLayoutEffect, useRef, useState } from "react";

import { PageHeaderSidebarTriggerProvider } from "../shared/page-header-sidebar-trigger-context.js";
import { shouldRenderSidebarTrigger } from "../shared/sidebar-trigger-visibility.js";

const DASHBOARD_SIDEBAR_WIDTH = "14rem";
const SidebarWidthStyle: React.CSSProperties & Record<`--${string}`, string> = {
  "--sidebar-width": DASHBOARD_SIDEBAR_WIDTH,
};

export interface AppShellViewProps {
  sidebarHeaderClassName?: string;
  sidebarHeaderContent: React.ReactNode;
  sidebarContent: React.ReactNode;
  sidebarFooterContent: React.ReactNode;
  sidebarDefaultOpen?: boolean;
  contentInsetOwner: "app-shell" | "child";
  mainContent: React.ReactNode;
  renderSidebarTrigger: boolean;
  sidebarEntryKey?: string;
  sidebarEntryState?: "collapsed" | null;
  topLoadingBar: React.ReactNode;
  viewportMode: "document" | "workspace";
}

export function AppShellView(input: AppShellViewProps): React.JSX.Element {
  const contentContainerClassName = resolveContentContainerClassName({
    contentInsetOwner: input.contentInsetOwner,
    viewportMode: input.viewportMode,
  });
  const sidebarEntryState = input.sidebarEntryState ?? null;
  const sidebarEntryKey = input.sidebarEntryKey ?? "";
  const initialSidebarOpen =
    sidebarEntryState === "collapsed" ? false : (input.sidebarDefaultOpen ?? true);
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);

  return (
    <SidebarProvider
      defaultOpen={initialSidebarOpen}
      onOpenChange={setSidebarOpen}
      open={sidebarOpen}
      style={SidebarWidthStyle}
    >
      <AppShellSidebarEntrySync
        entryKey={sidebarEntryKey}
        entryState={sidebarEntryState}
        setSidebarOpen={setSidebarOpen}
      />
      <Sidebar>
        {input.sidebarHeaderContent === null ? null : (
          <SidebarHeader className={input.sidebarHeaderClassName}>
            {input.sidebarHeaderContent}
          </SidebarHeader>
        )}
        <SidebarContent>{input.sidebarContent}</SidebarContent>
        <SidebarFooter>{input.sidebarFooterContent}</SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset
        className={
          input.viewportMode === "workspace"
            ? "from-background to-muted/20 h-svh overflow-hidden bg-linear-to-b"
            : "from-background to-muted/20 min-h-svh bg-linear-to-b"
        }
      >
        <AppShellPageHeaderSidebarTriggerProvider renderSidebarTrigger={input.renderSidebarTrigger}>
          {input.topLoadingBar}
          <div className={contentContainerClassName}>
            <div className="min-w-0 min-h-0 flex-1">{input.mainContent}</div>
          </div>
        </AppShellPageHeaderSidebarTriggerProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppShellSidebarEntrySync(input: {
  entryKey: string;
  entryState: "collapsed" | null;
  setSidebarOpen: (open: boolean) => void;
}): null {
  const { entryKey, entryState, setSidebarOpen } = input;
  const { setOpenMobile } = useSidebar();
  const appliedSidebarEntryKeyRef = useRef<string | null>(null);

  // Synchronizes route-owned sidebar posture before paint because route changes can arrive outside
  // this shell's event handlers.
  useLayoutEffect(() => {
    if (entryState !== "collapsed") {
      appliedSidebarEntryKeyRef.current = null;
      return;
    }

    if (appliedSidebarEntryKeyRef.current === entryKey) {
      return;
    }

    appliedSidebarEntryKeyRef.current = entryKey;
    setSidebarOpen(false);
    setOpenMobile(false);
  }, [entryKey, entryState, setOpenMobile, setSidebarOpen]);

  return null;
}

function AppShellPageHeaderSidebarTriggerProvider(input: {
  children: React.ReactNode;
  renderSidebarTrigger: boolean;
}): React.JSX.Element {
  const { isMobile, openMobile, state } = useSidebar();
  const shouldShowSidebarTrigger =
    input.renderSidebarTrigger &&
    shouldRenderSidebarTrigger({
      isMobile,
      openMobile,
      sidebarState: state,
    });

  return (
    <PageHeaderSidebarTriggerProvider
      value={{
        control: <SidebarTrigger className="-ml-1 shrink-0" />,
        isVisible: shouldShowSidebarTrigger,
      }}
    >
      {input.children}
    </PageHeaderSidebarTriggerProvider>
  );
}

function resolveContentContainerClassName(input: {
  contentInsetOwner: AppShellViewProps["contentInsetOwner"];
  viewportMode: AppShellViewProps["viewportMode"];
}): string {
  if (input.viewportMode === "workspace") {
    return "min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden";
  }

  if (input.contentInsetOwner === "child") {
    return "min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden";
  }

  return "min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-6";
}
