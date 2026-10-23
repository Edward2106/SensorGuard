import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  BarChart,
  Bar,
} from 'recharts';
import type { Reading } from './core';

export function points(readings: Reading[]) {
  return readings
    .filter(r => Number.isFinite(r.value) && Number.isFinite(Date.parse(r.timestamp)))
    .slice(0, 200)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map(r => ({ time: Date.parse(r.timestamp), value: r.value, unit: r.unit }));
}

export default function Charts({
  readings,
  thresholds = {},
  format,
  unit,
}: {
  readings: Reading[];
  thresholds?: Record<string, number>;
  format: (v: string) => string;
  unit?: string;
}) {
  const data = points(readings);
  if (!data.length) {
    return <p>No readings available in this window.</p>;
  }

  return (
    <div
      className="chart"
      role="img"
      aria-label="Historical readings chart; equivalent values are listed in the table below"
    >
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 12, right: 24, left: 10, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" />
          <XAxis
            dataKey="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={n => format(new Date(n).toISOString())}
            minTickGap={80}
            stroke="#94a3b8"
            fontSize={12}
          />
          <YAxis
            domain={['auto', 'auto']}
            stroke="#94a3b8"
            fontSize={12}
            unit={unit ? ` ${unit}` : undefined}
          />
          <Tooltip
            labelFormatter={n => format(new Date(Number(n)).toISOString())}
            formatter={(val: any) => [`${val ?? ''} ${unit || ''}`.trim(), 'Value']}
            contentStyle={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-md)',
              color: 'var(--ink)',
              fontSize: '12.5px',
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#10b981"
            strokeWidth={2}
            dot={data.length < 30}
            isAnimationActive={false}
          />
          {Object.entries(thresholds).map(([name, value]) => {
            if (value === undefined || value === null) return null;
            const isCrit = name.toLowerCase().includes('critical');
            return (
              <ReferenceLine
                key={name}
                y={value}
                stroke={isCrit ? '#ef4444' : '#f59e0b'}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: `${name}: ${value}`,
                  fill: isCrit ? '#ef4444' : '#f59e0b',
                  fontSize: 11,
                  position: 'right',
                }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Distribution({ values }: { values: Record<string, number> }) {
  const entries = Object.entries(values);
  if (!entries.length) {
    return <p>No data recorded.</p>;
  }

  const chartData = entries.map(([name, count]) => ({ name, count }));

  return (
    <>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" />
          <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
          <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={12} />
          <Tooltip
            contentStyle={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-md)',
              color: 'var(--ink)',
              fontSize: '12.5px',
            }}
          />
          <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: '12px' }}>
        {entries.map(([k, v]) => `${k}: ${v}`).join(' · ')}
      </p>
    </>
  );
}
