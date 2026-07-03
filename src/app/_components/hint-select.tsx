import type { Control } from "react-hook-form";
import { Controller } from "react-hook-form";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { IntakeInput } from "~/lib/magnetron";

export function HintSelect({
  control,
  name,
  label,
  values,
}: {
  control: Control<IntakeInput>;
  name: Extract<
    keyof IntakeInput,
    "videoResolution" | "videoSource" | "videoCodec" | "videoModifier"
  >;
  label: string;
  values: readonly string[];
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <Select
            onValueChange={(value) =>
              field.onChange(value === "__none" ? "" : value)
            }
            value={field.value || "__none"}
          >
            <SelectTrigger aria-invalid={fieldState.invalid} id={field.name}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">None</SelectItem>
              {values.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
