"use client";

import { Button } from "@photopipe/ui/components/button";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

const COMMAND = "brew install --cask raphaelmitas/tap/photopipe";

export function BrewCommand() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex items-center gap-1 rounded-4xl border border-border bg-card/60 py-1 pr-1 pl-4 font-mono text-muted-foreground text-xs sm:text-sm">
      <code className="truncate">{COMMAND}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Copied" : "Copy install command"}
        onClick={() => {
          navigator.clipboard.writeText(COMMAND).then(() => setCopied(true));
        }}
      >
        {copied ? <Check className="text-primary" /> : <Copy />}
      </Button>
    </div>
  );
}
