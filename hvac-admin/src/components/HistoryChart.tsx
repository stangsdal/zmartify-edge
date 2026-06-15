import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { HistoryPoint } from '../types/api';

interface HistoryChartProps {
  title: string;
  points: HistoryPoint[];
  color?: string;
}

export function HistoryChart({ title, points, color = '#301E96' }: HistoryChartProps) {
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
            <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(125,133,255,0.18)" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke={color} dot={false} strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
