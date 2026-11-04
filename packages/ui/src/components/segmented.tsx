import { cn } from "../lib/utils";

export function Segmented<T extends string>({
  value,
  options,
  testid,
  disabled,
  onChange,
}: {
  value: T;
  options: readonly [T, string][];
  testid: string;
  disabled?: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      className="flex w-full gap-0.5 rounded-4xl bg-muted p-0.5 dark:bg-black/25 ring-1 ring-border"
    >
      {options.map(([option, label]) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          disabled={disabled?.includes(option)}
          data-testid={`${testid}-${option}`}
          onClick={() => onChange(option)}
          className={cn(
            "relative finger-target h-7 flex-1 rounded-3xl px-2 font-medium text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50",
            value === option
              ? "bg-foreground/15 text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
