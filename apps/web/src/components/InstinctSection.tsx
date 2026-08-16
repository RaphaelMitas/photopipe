import { Card, CardContent } from "@photopipe/ui/components/card";
import { Section } from "@/components/Section";

const NUMBERS = [
  { value: "0–100", label: "One scale, stable across shoots" },
  { value: "On device", label: "Vision reads the raw, nothing leaves the Mac" },
  { value: "32 ms", label: "Warm loupe re-render, 33 MP ARW" },
  { value: "0 files", label: "Written until you ask" },
];

export function InstinctSection() {
  return (
    <Section
      eyebrow="Instinct"
      title="The first pass is already done."
      lede="A background pass scores every frame with Apple's Vision aesthetics model, on your Mac, straight from the raw. Nothing is uploaded and no account exists to upload it to. The result is one number from 0 to 100 that means the same thing in every project: sort by Instinct and the shoot arrives roughly in the order you would have put it in."
    >
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {NUMBERS.map((number) => (
          <Card key={number.value}>
            <CardContent>
              <p className="font-heading text-3xl text-primary tracking-tight">
                {number.value}
              </p>
              <p className="mt-2 text-muted-foreground text-sm">
                {number.label}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </Section>
  );
}
