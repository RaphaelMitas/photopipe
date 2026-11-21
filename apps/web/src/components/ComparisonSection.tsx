import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@photopipe/ui/components/card";
import { cn } from "@photopipe/ui/lib/utils";
import { Fragment } from "react";
import { Section } from "@/components/Section";
import { TextLink } from "@/components/TextLink";
import type { IntentPage } from "@/lib/intent-pages";

const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});

function PickCard({
  name,
  reasons,
  note,
  accent = false,
}: {
  name: string;
  reasons: string[];
  note?: string;
  accent?: boolean;
}) {
  return (
    <Card
      className={cn(
        "h-full gap-4",
        accent && "ring-primary/40 dark:ring-primary/40",
      )}
    >
      <CardHeader>
        <CardTitle className="text-lg">
          <h3>
            Pick <span className={cn(accent && "text-primary")}>{name}</span> if
          </h3>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul
          className={cn(
            "flex list-disc flex-col gap-2.5 pl-5 text-base text-muted-foreground leading-relaxed",
            accent && "marker:text-primary",
          )}
        >
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        {note ? (
          <p className="mt-5 border-border border-t pt-4 text-muted-foreground text-sm leading-relaxed">
            {note}{" "}
            <TextLink href="#workflow" className="whitespace-nowrap">
              See the four steps
            </TextLink>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ColumnLabel({
  className,
  children,
}: {
  className?: string;
  children: string;
}) {
  return (
    <>
      <span className={cn("mb-1 block text-xs md:hidden", className)}>
        {children}
        <span className="sr-only">:</span>
      </span>{" "}
    </>
  );
}

export function ComparisonSection({ page }: { page: IntentPage }) {
  return (
    <Section
      eyebrow="Side by side"
      title={`Photopipe or ${page.rival}?`}
      lede={
        <>
          {page.whyThisRival} Compared in{" "}
          <time dateTime={page.updated}>
            {MONTH.format(new Date(page.updated))}
          </time>
          .
        </>
      }
    >
      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <PickCard name="Photopipe" reasons={page.pick.photopipe} accent />
        <PickCard
          name={page.rival}
          reasons={page.pick.rival}
          note={page.pick.keepingRival}
        />
      </div>
      <div className="mt-6 overflow-hidden rounded-4xl bg-card shadow-md ring-1 ring-foreground/10">
        <table className="w-full text-left text-sm md:table-fixed md:text-base">
          <caption className="sr-only">
            Photopipe compared with {page.rival}
          </caption>
          <colgroup>
            <col className="md:w-1/4" />
            <col className="md:w-[37.5%]" />
            <col />
          </colgroup>
          <thead className="hidden bg-foreground/[0.03] font-heading md:table-header-group">
            <tr>
              <td />
              <th
                scope="col"
                className="bg-primary/[0.03] px-6 py-4 font-medium text-primary"
              >
                Photopipe
              </th>
              <th scope="col" className="px-6 py-4 font-medium">
                {page.rival}
              </th>
            </tr>
          </thead>
          <tbody>
            {page.comparison.map((row) => (
              <Fragment key={row.feature}>
                <tr className="border-border border-t first:border-t-0 md:hidden">
                  <th
                    colSpan={3}
                    className="px-6 pt-3 font-medium text-foreground/80 text-xs uppercase tracking-[0.14em]"
                  >
                    {row.feature}
                  </th>
                </tr>
                <tr className="md:border-border md:border-t">
                  <th
                    scope="row"
                    className="hidden px-6 py-4 align-top font-medium md:table-cell"
                  >
                    {row.feature}
                  </th>
                  <td className="w-1/2 pt-1 pr-3 pb-3 pl-6 align-top md:w-auto md:bg-primary/[0.03] md:px-6 md:py-4">
                    <ColumnLabel className="text-primary">
                      Photopipe
                    </ColumnLabel>
                    {row.photopipe}
                  </td>
                  <td className="w-1/2 pt-1 pr-6 pb-3 pl-3 align-top text-muted-foreground md:w-auto md:px-6 md:py-4">
                    <ColumnLabel>{page.rival}</ColumnLabel>
                    {row.rival}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-8 text-muted-foreground">
        {page.related.lead}{" "}
        <TextLink href={`/${page.related.slug}`}>{page.related.label}</TextLink>
      </p>
    </Section>
  );
}
