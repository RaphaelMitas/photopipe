import { Badge } from "@photopipe/ui/components/badge";

const SPECS = [
  { lead: "Apple raw", rest: "decode" },
  { lead: "Neural Engine", rest: "denoise" },
  { lead: "Vision", rest: "aesthetic scoring" },
  { lead: "Display P3", rest: "render" },
  { lead: "XMP", rest: "read and write" },
  { lead: "Swift + Metal", rest: "core" },
];

export function SpecStrip() {
  return (
    <div className="border-border/60 border-y bg-card/30">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-3 px-6 py-6">
        {SPECS.map((spec) => (
          <Badge
            key={spec.lead}
            variant="outline"
            className="gap-1 px-3 py-1.5"
          >
            <span className="font-semibold text-foreground">{spec.lead}</span>
            <span className="text-muted-foreground">{spec.rest}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}
