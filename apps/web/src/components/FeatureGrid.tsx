import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@photopipe/ui/components/card";
import {
  BarChart3,
  Clock,
  FolderOpen,
  ShieldCheck,
  Star,
  Upload,
} from "lucide-react";
import { Section } from "@/components/Section";

const FEATURES = [
  {
    icon: FolderOpen,
    title: "Your folders are the truth",
    body: "No catalogue, no import step. Photopipe watches the folder with FSEvents, so a file you move in Finder moves in the app. The index is a rebuildable cache, never a source of truth.",
  },
  {
    icon: Star,
    title: "Ratings that travel",
    body: "Stars, tone, colour, curves and crop go out as XMP: a sidecar beside a raw, embedded in a DNG. Lightroom and Capture One read the same decisions.",
  },
  {
    icon: BarChart3,
    title: "Histogram as filter",
    body: 'Six bars, a count each. Click one to narrow, refine with ≥ = ≤ ∅. One control answers "how far am I" and "show me the keepers".',
  },
  {
    icon: Upload,
    title: "Export that renders",
    body: "Originals byte-for-byte, or full-resolution JPEG with every edit baked in at quality 90 or 100. Folder or zip, flat or mirrored, never a silent overwrite.",
  },
  {
    icon: Clock,
    title: "Jobs, not toasts",
    body: "Exports run in the drawer's activity list: running, done with a reveal button, or failed with the error still on screen four minutes later.",
  },
  {
    icon: ShieldCheck,
    title: "Native and self-contained",
    body: "A Swift core doing every pixel, in one bundle with the raw pipeline inside. Nothing else to install, and it keeps itself up to date without ever asking who you are.",
  },
];

export function FeatureGrid() {
  return (
    <Section eyebrow="The rest of it" title="Everything else the job needs.">
      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <Card key={feature.title} className="h-full">
            <CardHeader>
              <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <feature.icon className="size-5" />
              </div>
              <CardTitle className="font-heading text-lg">
                {feature.title}
              </CardTitle>
              <CardDescription className="mt-2 leading-relaxed">
                {feature.body}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </Section>
  );
}
