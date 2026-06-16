import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts';
import { HistoryPoint } from '../types/api';

interface HistoryChartProps {
  title: string;
  points: HistoryPoint[];
  color?: string;
  mode?: 'line' | 'step';
  binary?: boolean;
  chartType?: 'line' | 'area';
}

export function HistoryChart({
  title,
  points,
  color = '#301E96',
  mode = 'line',
  binary = false,
  chartType = 'line',
}: HistoryChartProps) {
  const data = points.map((p) => ({
    time: new Date(p.bucket_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    value: p.value,
  }));

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
                <XAxis dataKey="time" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  domain={binary ? [0, 1] : ['auto', 'auto']}
                  ticks={binary ? [0, 1] : undefined}
                  allowDecimals={!binary}
                />
                <Tooltip formatter={(value) => {
                  const numeric = typeof value === 'number' ? value : Number(value);
                  if (!binary || Number.isNaN(numeric)) {
                    return value;
                  }
                  return numeric >= 0.5 ? 'On' : 'Off';
                }} />
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
                <XAxis dataKey="time" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  domain={binary ? [0, 1] : ['auto', 'auto']}
                  ticks={binary ? [0, 1] : undefined}
                  allowDecimals={!binary}
                />
                <Tooltip formatter={(value) => {
                  const numeric = typeof value === 'number' ? value : Number(value);
                  if (!binary || Number.isNaN(numeric)) {
                    return value;
                  }
                  return numeric >= 0.5 ? 'On' : 'Off';
                }} />
                <Line
                  type={mode === 'step' ? 'stepAfter' : 'monotone'}
                  dataKey="value"
                  stroke={color}
                  dot={false}
                  strokeWidth={3}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
