import { HealthBadge } from './HealthBadge';

interface AlertCardProps {
  title: string;
  detail: string;
  time: string;
  priority: 'critical' | 'warning' | 'info';
}

const badgeTone = {
  critical: 'critical',
  warning: 'warn',
  info: 'info',
} as const;

export function AlertCard({ title, detail, time, priority }: AlertCardProps) {
  return (
    <div className="rounded-2xl p-4 app-surface shadow-soft border border-slate-100">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{title}</p>
        <HealthBadge label={priority.toUpperCase()} tone={badgeTone[priority]} />
      </div>
      <p className="text-sm text-muted mt-2">{detail}</p>
      <p className="text-xs text-muted mt-2">{new Date(time).toLocaleString()}</p>
    </div>
  );
}
