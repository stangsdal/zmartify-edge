interface TemperatureBadgeProps {
  value?: number;
  unit?: string;
}

export function TemperatureBadge({ value, unit = '°C' }: TemperatureBadgeProps) {
  const text = value === undefined || value === null ? '--' : value.toFixed(1);
  return <span className="text-[28px] font-bold tracking-normal text-brand-primary">{text}{unit}</span>;
}
