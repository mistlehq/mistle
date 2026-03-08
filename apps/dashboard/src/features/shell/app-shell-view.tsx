import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@mistle/ui";

const DASHBOARD_SIDEBAR_WIDTH = "14rem";
const SidebarWidthStyle: React.CSSProperties & Record<`--${string}`, string> = {
  "--sidebar-width": DASHBOARD_SIDEBAR_WIDTH,
};

type AppShellViewProps = {
  sidebarHeaderClassName?: string;
  sidebarHeaderContent: React.ReactNode;
  sidebarContent: React.ReactNode;
  sidebarFooterContent: React.ReactNode;
  breadcrumbs: React.ReactNode | null;
  headerActions: React.ReactNode | null;
  mainContent: React.ReactNode;
  topLoadingBar: React.ReactNode;
  isSessionDetail: boolean;
  showBreadcrumbs: boolean;
};

export function AppShellView(input: AppShellViewProps): React.JSX.Element {
  return (
    <SidebarProvider style={SidebarWidthStyle}>
      <Sidebar>
        <SidebarHeader className={input.sidebarHeaderClassName}>
          {input.sidebarHeaderContent}
        </SidebarHeader>
        <SidebarContent>{input.sidebarContent}</SidebarContent>
        <SidebarFooter>{input.sidebarFooterContent}</SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset
        className={
          input.isSessionDetail
            ? "from-background to-muted/20 h-svh overflow-hidden bg-linear-to-b"
            : "from-background to-muted/20 min-h-svh bg-linear-to-b"
        }
      >
        {input.topLoadingBar}
        <header className="bg-background/80 sticky top-0 z-10 flex h-12 items-center border-b px-4 backdrop-blur-sm">
          <SidebarTrigger className="-ml-1" />
          {input.showBreadcrumbs ? (
            <div className="ml-2 min-w-0 flex-1">{input.breadcrumbs}</div>
          ) : (
            <div className="flex-1" />
          )}
          {input.headerActions === null ? null : (
            <div className="ml-4 shrink-0">{input.headerActions}</div>
          )}
        </header>
        <div
          className={
            input.isSessionDetail
              ? "min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden"
              : "min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-6"
          }
        >
          <div className="min-w-0 min-h-0 flex-1">{input.mainContent}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
