import { Button } from "./button";
import { ButtonGroup } from "./button-group";

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
    <ButtonGroup className="w-full">
      {options.map(([option, label]) => (
        <Button
          key={option}
          size="sm"
          variant={value === option ? "secondary" : "outline"}
          aria-pressed={value === option}
          disabled={disabled?.includes(option)}
          data-testid={`${testid}-${option}`}
          onClick={() => onChange(option)}
          className="flex-1 text-xs"
        >
          {label}
        </Button>
      ))}
    </ButtonGroup>
  );
}
