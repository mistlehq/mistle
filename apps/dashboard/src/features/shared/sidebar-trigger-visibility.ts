export function shouldRenderSidebarTrigger(input: {
  isMobile: boolean;
  openMobile: boolean;
  sidebarState: "expanded" | "collapsed";
}): boolean {
  return input.isMobile ? !input.openMobile : input.sidebarState === "collapsed";
}
