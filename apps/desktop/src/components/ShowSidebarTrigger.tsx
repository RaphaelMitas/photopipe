import { SidebarTrigger, useSidebar } from "@photopipe/ui/components/sidebar";

// The sidebar slides out whole, taking its own trigger with it.
export function ShowSidebarTrigger() {
  const { isMobile, state } = useSidebar();

  // On mobile it stays mounted under the sheet's overlay, so closing the sheet
  // has somewhere to hand focus back to.
  if (!isMobile && state === "expanded") return null;

  return (
    <SidebarTrigger
      className="-ml-1 text-muted-foreground"
      title="Show sidebar (⌘B)"
    />
  );
}
