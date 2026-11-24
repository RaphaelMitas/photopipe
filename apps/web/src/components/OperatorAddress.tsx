import { OPERATOR } from "@/lib/operator";

export function OperatorAddress() {
  return (
    <address className="mt-4 text-muted-foreground not-italic leading-relaxed">
      {[OPERATOR.name, ...OPERATOR.address].map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </address>
  );
}
