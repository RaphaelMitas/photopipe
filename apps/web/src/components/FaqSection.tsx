import { Section } from "@/components/Section";
import { FAQ } from "@/lib/faq";

export function FaqSection() {
  return (
    <Section eyebrow="FAQ" title="Questions, answered.">
      <div className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2">
        {FAQ.map((item) => (
          <div key={item.question}>
            <h3 className="font-medium text-lg">{item.question}</h3>
            <p className="mt-2 text-muted-foreground leading-relaxed">
              {item.answer}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
