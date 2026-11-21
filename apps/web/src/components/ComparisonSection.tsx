import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@photopipe/ui/components/card";
import { Section } from "@/components/Section";
import type { IntentPage } from "@/lib/intent-pages";

function PickCard({ name, reasons }: { name: string; reasons: string[] }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg">
          <h3>Pick {name} if</h3>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3 text-muted-foreground leading-relaxed">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function ComparisonSection({ page }: { page: IntentPage }) {
  return (
    <Section
      eyebrow={`Photopipe and ${page.rival}`}
      title="Where each one is stronger."
    >
      <div className="mt-12 overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-card/60 font-heading text-base">
            <tr className="grid grid-cols-2 md:table-row">
              <td className="hidden w-1/4 md:table-cell" />
              <th scope="col" className="px-5 py-4 font-medium text-primary">
                Photopipe
              </th>
              <th scope="col" className="px-5 py-4 font-medium">
                {page.rival}
              </th>
            </tr>
          </thead>
          <tbody>
            {page.comparison.map((row) => (
              <tr
                key={row.feature}
                className="grid grid-cols-2 border-border border-t md:table-row"
              >
                <th
                  scope="row"
                  className="col-span-2 px-5 pt-4 align-top font-medium md:py-4"
                >
                  {row.feature}
                </th>
                <td className="px-5 pt-1 pb-4 align-top md:py-4">
                  {row.photopipe}
                </td>
                <td className="px-5 pt-1 pb-4 align-top text-muted-foreground md:py-4">
                  {row.rival}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <PickCard name="Photopipe" reasons={page.pick.photopipe} />
        <PickCard name={page.rival} reasons={page.pick.rival} />
      </div>
    </Section>
  );
}
