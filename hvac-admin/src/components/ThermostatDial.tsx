import { useMemo } from 'react';

interface ThermostatDialProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}

export function ThermostatDial({ value, min = 12, max = 30, step = 0.5, onChange }: ThermostatDialProps) {
  const ratio = useMemo(() => (value - min) / (max - min), [value, min, max]);
  const angle = 270 * ratio - 135;

  return (
    <div className="relative mx-auto w-[280px] h-[280px]">
      <svg viewBox="0 0 280 280" className="absolute inset-0">
        <circle cx="140" cy="140" r="110" stroke="rgba(125,133,255,0.25)" strokeWidth="16" fill="none" />
        <circle
          cx="140"
          cy="140"
          r="110"
          stroke="#301E96"
          strokeWidth="16"
          fill="none"
          strokeDasharray={`${2 * Math.PI * 110}`}
          strokeDashoffset={`${(1 - ratio) * 2 * Math.PI * 110}`}
          strokeLinecap="round"
          transform="rotate(-135 140 140)"
        />
        <line
          x1="140"
          y1="140"
          x2={140 + 92 * Math.cos((angle * Math.PI) / 180)}
          y2={140 + 92 * Math.sin((angle * Math.PI) / 180)}
          stroke="#67FBFF"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <p className="text-sm text-muted">Target</p>
        <p className="text-6xl font-bold text-brand-primary leading-none">{value.toFixed(1)}°</p>
      </div>

      <input
        aria-label="Temperature dial"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[220px]"
      />
    </div>
  );
}
