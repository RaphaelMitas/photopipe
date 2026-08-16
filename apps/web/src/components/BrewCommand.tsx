"use client";

import { Button } from "@photopipe/ui/components/button";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

const COMMAND = "brew install --cask raphaelmitas/tap/photopipe";

function selectText(node: Element | null | undefined) {
  if (!node) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function BrewCommand() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex max-w-full items-center gap-1 rounded-4xl border border-border bg-card/60 py-1 pr-1 pl-4 font-mono text-muted-foreground text-xs sm:text-sm">
      <code className="min-w-0 truncate">{COMMAND}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Copied" : "Copy install command"}
        onClick={async (event) => {
          try {
            await navigator.clipboard.writeText(COMMAND);
            setCopied(true);
          } catch {
            selectText(
              event.currentTarget.parentElement?.querySelector("code"),
            );
          }
        }}
      >
        {copied ? <Check className="text-primary" /> : <Copy />}
      </Button>
    </div>
  );
}
