import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "@mistle/ui";

const DASHBOARD_SIDEBAR_WIDTH = "14rem";

export function PendingSessionShell(): React.JSX.Element {
  return (
    <SidebarProvider style={{ "--sidebar-width": DASHBOARD_SIDEBAR_WIDTH } as React.CSSProperties}>
      <Sidebar>
        <SidebarHeader />
        <SidebarContent />
        <SidebarFooter />
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <header className="bg-background/80 sticky top-0 z-10 flex h-12 items-center border-b px-4 backdrop-blur-sm">
          <div className="min-h-5 min-w-5" />
          <div className="ml-2 min-w-0 flex-1" />
        </header>
        <div className="min-w-0 flex flex-1 flex-col px-4 py-6">
          <div className="min-w-0 flex-1" />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
