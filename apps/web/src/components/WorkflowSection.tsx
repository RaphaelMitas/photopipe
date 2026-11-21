import { Card, CardContent } from "@photopipe/ui/components/card";
import { Section } from "@/components/Section";
import { TextLink } from "@/components/TextLink";
import type { IntentPage } from "@/lib/intent-pages";

export function WorkflowSection({
  workflow,
}: {
  workflow: IntentPage["workflow"];
}) {
  return (
    <Section eyebrow="How it goes" title={workflow.title}>
      <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {workflow.steps.map((step, index) => (
          <li key={step.title}>
            <Card className="h-full">
              <CardContent>
                <p
                  aria-hidden
                  className="font-heading text-3xl text-primary tracking-tight"
                >
                  {index + 1}
                </p>
                <h3 className="mt-3 text-balance font-medium text-lg lg:min-h-14">
                  {step.title}
                </h3>
                <p className="mt-2 text-pretty text-base text-muted-foreground leading-relaxed">
                  {step.body}
                </p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
      <p className="mt-8 max-w-2xl text-pretty text-muted-foreground leading-relaxed">
        Photopipe is built by{" "}
        <TextLink href="https://raphaelmitas.com">Raphael Mitas</TextLink>, a
        hobby event photographer, for his own dance shoots of 2000 to 3000 raws
        a night.
      </p>
    </Section>
  );
}
