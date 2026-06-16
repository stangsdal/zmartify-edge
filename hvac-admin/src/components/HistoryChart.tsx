import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts';
import { HistoryPoint } from '../types/api';

interface HistoryChartProps {
  title: string;
  points: HistoryPoint[];
  color?: string;
  mode?: 'line' | 'step';
  smooth?: boolean;
  binary?: boolean;
  binaryLabels?: [string, string]; // [offLabel, onLabel] — overrides axis ticks and tooltip
  chartType?: 'line' | 'area';
  startMs?: number;
  endMs?: number;
}

export function HistoryChart({
  title,
  points,
  color = '#301E96',
  mode = 'line',
  smooth = false,
  binary = false,
  binaryLabels,
  chartType = 'line',
  startMs,
  endMs,
}: HistoryChartProps) {
  const isBinary = binary || binaryLabels != null;
  const offLabel = binaryLabels?.[0] ?? 'Off';
  const onLabel  = binaryLabels?.[1] ?? 'On';
  const baseData = points
    .map((p) => ({
      ts: new Date(p.bucket_start).getTime(),
      value: p.value,
    }))
    .filter((p) => Number.isFinite(p.ts))
    .sort((a, b) => a.ts - b.ts);

  const data = (() => {
    if (baseData.length === 0) {
      return baseData;
    }

    // For step charts, carry first/last known state to the full selected window.
    if (mode !== 'step' || startMs == null || endMs == null) {
      return baseData;
    }

    const next = [...baseData];
    if (next[0].ts > startMs) {
      next.unshift({ ts: startMs, value: next[0].value });
    }
    if (next[next.length - 1].ts < endMs) {
      next.push({ ts: endMs, value: next[next.length - 1].value });
    }
    return next;
  })();

  const formatTooltipTime = (label: unknown) => {
    const ts = Number(label);
    if (!Number.isFinite(ts)) {
      return String(label ?? '');
    }
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="rounded-2xl p-4 app-surface shadow-soft border border-slate-100">
      <p className="font-semibold mb-3">{title}</p>
      {data.length === 0 ? (
        <p className="text-sm text-muted">No data in selected window.</p>
      ) : (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'area' ? (
              <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(125,133,255,0.18)" />
                <XAxis
                  type="number"
                  dataKey="ts"
                  domain={startMs != null && endMs != null ? [startMs, endMs] : ['dataMin', 'dataMax']}
                  allowDataOverflow
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => new Date(Number(value)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={isBinary ? 52 : 36}
                  domain={isBinary ? [0, 1] : ['auto', 'auto']}
                  ticks={isBinary ? [0, 1] : undefined}
                  allowDecimals={!isBinary}
                  tickFormatter={(v) => isBinary ? (Number(v) >= 0.5 ? onLabel : offLabel) : String(v)}
                />
                <Tooltip
                  labelFormatter={formatTooltipTime}
                  formatter={(value) => {
                  const numeric = typeof value === 'number' ? value : Number(value);
                  if (!isBinary || Number.isNaN(numeric)) {
                    return value;
                  }
                  return numeric >= 0.5 ? onLabel : offLabel;
                  }}
                />
                <Area
                  type={mode === 'step' ? 'stepAfter' : 'monotone'}
                  dataKey="value"
                  stroke={color}
                  fill={color}
                  fillOpacity={0.28}
                  dot={false}
                  strokeWidth={2}
                />
              </AreaChart>
            ) : (
              <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(125,133,255,0.18)" />
                <XAxis
                  type="number"
                  dataKey="ts"
                  domain={startMs != null && endMs != null ? [startMs, endMs] : ['dataMin', 'dataMax']}
                  allowDataOverflow
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => new Date(Number(value)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={isBinary ? 52 : 36}
                  domain={isBinary ? [0, 1] : ['auto', 'auto']}
                  ticks={isBinary ? [0, 1] : undefined}
                  allowDecimals={!isBinary}
                  tickFormatter={(v) => isBinary ? (Number(v) >= 0.5 ? onLabel : offLabel) : String(v)}
                />
                <Tooltip
                  labelFormatter={formatTooltipTime}
                  formatter={(value) => {
                  const numeric = typeof value === 'number' ? value : Number(value);
                  if (!isBinary || Number.isNaN(numeric)) {
                    return value;
                  }
                  return numeric >= 0.5 ? onLabel : offLabel;
                  }}
                />
                <Line
                  type={mode === 'step' ? 'stepAfter' : smooth ? 'monotone' : 'linear'}
                  dataKey="value"
                  stroke={color}
                  dot={false}
                  strokeWidth={3}
                  connectNulls
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
