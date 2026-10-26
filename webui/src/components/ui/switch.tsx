import { Switch as BaseSwitch } from "@base-ui/react/switch";
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="switch-label">
      <BaseSwitch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="switch-root"
      >
        <BaseSwitch.Thumb className="switch-thumb" />
      </BaseSwitch.Root>
      <span>{label}</span>
    </label>
  );
}
