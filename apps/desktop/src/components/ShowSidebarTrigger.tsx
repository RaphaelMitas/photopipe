import { SidebarTrigger, useSidebar } from "@photopipe/ui/components/sidebar";

// The sidebar slides out whole, taking its own trigger with it.
export function ShowSidebarTrigger() {
  const { isMobile, openMobile, state } = useSidebar();

  if (isMobile ? openMobile : state === "expanded") return null;

  return (
    <SidebarTrigger
      className="-ml-1 text-muted-foreground"
      title="Show sidebar (⌘B)"
    />
  );
}
