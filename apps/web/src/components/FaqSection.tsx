import { Section } from "@/components/Section";
import { TextLink } from "@/components/TextLink";
import type { FaqItem } from "@/lib/faq";

export function FaqSection({
  title = "Questions, answered.",
  items,
}: {
  title?: string;
  items: FaqItem[];
}) {
  return (
    <Section eyebrow="FAQ" title={title}>
      <div className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2">
        {items.map((item) => (
          <div key={item.question}>
            <h3 className="font-medium text-lg">{item.question}</h3>
            <p className="mt-2 text-pretty text-muted-foreground leading-relaxed">
              {item.answer}
            </p>
            {item.link ? (
              <TextLink href={item.link.href} className="mt-2 inline-block">
                {item.link.label}
              </TextLink>
            ) : null}
          </div>
        ))}
      </div>
    </Section>
  );
}
