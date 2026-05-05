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
  headerLeadingContent: React.ReactNode | null;
  contentInsetOwner: "app-shell" | "child";
  autosaveIndicator: React.ReactNode | null;
  headerActions: React.ReactNode | null;
  mainContent: React.ReactNode;
  renderSidebarTrigger: boolean;
  showHeader: boolean;
  topLoadingBar: React.ReactNode;
  viewportMode: "document" | "workspace";
  showHeaderLeadingContent: boolean;
}

export function AppShellView(input: AppShellViewProps): React.JSX.Element {
  const contentContainerClassName = resolveContentContainerClassName({
    contentInsetOwner: input.contentInsetOwner,
    viewportMode: input.viewportMode,
  });
  const shouldRenderHeaderContent =
    input.showHeader &&
    (input.showHeaderLeadingContent ||
      input.headerActions !== null ||
      input.autosaveIndicator !== null);

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
        <AppShellStickyHeader {...input} showHeaderContent={shouldRenderHeaderContent} />
        <div className={contentContainerClassName}>
          <div className="min-w-0 min-h-0 flex-1">{input.mainContent}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppShellStickyHeader(
  input: Pick<
    AppShellViewProps,
    | "autosaveIndicator"
    | "headerLeadingContent"
    | "headerActions"
    | "renderSidebarTrigger"
    | "showHeaderLeadingContent"
  > & {
    showHeaderContent: boolean;
  },
): React.JSX.Element | null {
  const { isMobile, openMobile, state } = useSidebar();
  const shouldShowSidebarTrigger =
    input.renderSidebarTrigger &&
    shouldRenderSidebarTrigger({
      isMobile,
      openMobile,
      sidebarState: state,
    });
  const hasHeaderTrailingContent = input.headerActions !== null || input.autosaveIndicator !== null;

  if (
    !shouldRenderAppShellStickyHeader({
      hasHeaderContent: input.showHeaderContent,
      hasSidebarTrigger: shouldShowSidebarTrigger,
    })
  ) {
    return null;
  }

  return (
    <header className="bg-background/80 sticky top-0 z-10 flex h-12 items-center border-b px-4 backdrop-blur-sm">
      {shouldShowSidebarTrigger ? <SidebarTrigger className="-ml-1" /> : null}
      {input.showHeaderContent && input.showHeaderLeadingContent ? (
        <div className={`${shouldShowSidebarTrigger ? "ml-2" : ""} min-w-0 flex-1`}>
          {input.headerLeadingContent}
        </div>
      ) : (
        <div className="flex-1" />
      )}
      {input.showHeaderContent && hasHeaderTrailingContent ? (
        <div className="ml-4 flex shrink-0 items-center gap-2">
          {input.headerActions}
          {input.autosaveIndicator}
        </div>
      ) : null}
    </header>
  );
}

export function shouldRenderAppShellStickyHeader(input: {
  hasHeaderContent: boolean;
  hasSidebarTrigger: boolean;
}): boolean {
  return input.hasHeaderContent || input.hasSidebarTrigger;
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
