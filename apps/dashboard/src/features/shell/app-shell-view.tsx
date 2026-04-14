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
  headerActions: React.ReactNode | null;
  mainContent: React.ReactNode;
  topLoadingBar: React.ReactNode;
  viewportMode: "document" | "workspace";
  showHeaderLeadingContent: boolean;
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
        <AppShellStickyHeader {...input} />
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
    "headerLeadingContent" | "headerActions" | "showHeaderLeadingContent"
  >,
): React.JSX.Element {
  const { isMobile, openMobile, state } = useSidebar();
  const shouldRenderSidebarTrigger = isMobile ? !openMobile : state === "collapsed";

  return (
    <header className="bg-background/80 sticky top-0 z-10 flex h-12 items-center border-b px-4 backdrop-blur-sm">
      {shouldRenderSidebarTrigger ? <SidebarTrigger className="-ml-1" /> : null}
      {input.showHeaderLeadingContent ? (
        <div className={`${shouldRenderSidebarTrigger ? "ml-2" : ""} min-w-0 flex-1`}>
          {input.headerLeadingContent}
        </div>
      ) : (
        <div className="flex-1" />
      )}
      {input.headerActions === null ? null : (
        <div className="ml-4 shrink-0">{input.headerActions}</div>
      )}
    </header>
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
