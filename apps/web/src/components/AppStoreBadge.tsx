import Image from "next/image";
import { APP_STORE } from "@/lib/release";

export function AppStoreBadge() {
  return (
    <a
      href={APP_STORE}
      data-event="Download"
      data-event-via="app-store"
      className="rounded-[9px] outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <Image
        src="/badges/mac-app-store.svg"
        alt="Download on the Mac App Store"
        width={156}
        height={40}
        unoptimized
        className="h-10 w-auto"
      />
    </a>
  );
}
