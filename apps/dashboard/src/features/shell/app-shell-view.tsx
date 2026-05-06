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
  contentInsetOwner: "app-shell" | "child";
  mainContent: React.ReactNode;
  renderSidebarTrigger: boolean;
  topLoadingBar: React.ReactNode;
  viewportMode: "document" | "workspace";
}

export function AppShellView(input: AppShellViewProps): React.JSX.Element {
  const contentContainerClassName = resolveContentContainerClassName({
    contentInsetOwner: input.contentInsetOwner,
    viewportMode: input.viewportMode,
  });
  return (
    <SidebarProvider style={SidebarWidthStyle}>
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
        {input.topLoadingBar}
        <AppShellSidebarTrigger renderSidebarTrigger={input.renderSidebarTrigger} />
        <div className={contentContainerClassName}>
          <div className="min-w-0 min-h-0 flex-1">{input.mainContent}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppShellSidebarTrigger(input: {
  renderSidebarTrigger: boolean;
}): React.JSX.Element | null {
  const { isMobile, openMobile, state } = useSidebar();
  const shouldShowSidebarTrigger =
    input.renderSidebarTrigger &&
    shouldRenderSidebarTrigger({
      isMobile,
      openMobile,
      sidebarState: state,
    });

  if (!shouldShowSidebarTrigger) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed top-3 left-3 z-20">
      <SidebarTrigger className="bg-background/90 pointer-events-auto shadow-sm backdrop-blur-sm" />
    </div>
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
