import { Button } from "@photopipe/ui/components/button";
import { AppWindowMac } from "lucide-react";
import { APP_STORE } from "@/lib/release";

export function AppStoreButton() {
  return (
    <Button asChild size="lg" variant="outline">
      <a href={APP_STORE}>
        <AppWindowMac data-icon="inline-start" />
        Mac App Store
      </a>
    </Button>
  );
}
