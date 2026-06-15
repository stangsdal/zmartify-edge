interface HealthBadgeProps {
  label: string;
  tone: 'good' | 'warn' | 'critical' | 'info';
}

const toneMap: Record<HealthBadgeProps['tone'], string> = {
  good: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-800',
  critical: 'bg-rose-100 text-rose-800',
  info: 'bg-cyan-100 text-cyan-800',
};

export function HealthBadge({ label, tone }: HealthBadgeProps) {
  return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${toneMap[tone]}`}>{label}</span>;
}
