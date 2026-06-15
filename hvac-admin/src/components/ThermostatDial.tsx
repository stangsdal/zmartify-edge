import { useMemo } from 'react';

interface ThermostatDialProps {
  value: number;
  currentTemperature?: number | null;
  roomName?: string;
  statusLabel?: string;
  heating?: boolean;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}

export function ThermostatDial({
  value,
  currentTemperature,
  roomName,
  statusLabel,
  heating = false,
  min = 12,
  max = 30,
  step = 0.5,
  onChange,
}: ThermostatDialProps) {
  const ratio = useMemo(() => (value - min) / (max - min), [value, min, max]);
  const angle = 270 * ratio - 135;
  const primaryColor = heating ? '#FF6A2B' : '#67FBFF';
  const secondaryColor = heating ? '#ffb08f' : 'rgba(255,255,255,0.65)';

  return (
    <div className="relative mx-auto w-full max-w-[360px] overflow-hidden rounded-[2rem] border border-white/10 hero-glow bg-[radial-gradient(circle_at_top,rgba(103,251,255,0.16),transparent_38%),linear-gradient(180deg,rgba(21,28,44,0.92),rgba(21,28,44,0.78))] p-5 text-white shadow-2xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(103,251,255,0.16),transparent_25%),radial-gradient(circle_at_82%_20%,rgba(255,106,43,0.18),transparent_28%)]" />

      <div className="relative flex items-center justify-between text-xs uppercase tracking-[0.28em] text-white/70">
        <span>{roomName || 'Thermostat'}</span>
        <span>{heating ? 'Heating' : statusLabel || 'Idle'}</span>
      </div>

      <div className="relative mt-4 flex items-center justify-center">
        <svg viewBox="0 0 280 280" className="h-[240px] w-[240px]">
          <circle cx="140" cy="140" r="110" stroke="rgba(255,255,255,0.18)" strokeWidth="16" fill="none" />
          <circle
            cx="140"
            cy="140"
            r="110"
            stroke={primaryColor}
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
            stroke={primaryColor}
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle
            cx={140 + 92 * Math.cos((angle * Math.PI) / 180)}
            cy={140 + 92 * Math.sin((angle * Math.PI) / 180)}
            r="6"
            fill={primaryColor}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <p className="text-[4rem] font-semibold leading-none tracking-tight text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.28)]">
            {currentTemperature == null ? '--' : currentTemperature.toFixed(1)}
            <span className="align-top text-3xl font-medium text-white/90">°C</span>
          </p>
          <p className="mt-2 text-sm text-white/75">Setpoint</p>
          <p className="text-[1.9rem] font-semibold leading-none" style={{ color: secondaryColor }}>
            {value.toFixed(1)}°C
          </p>
          <p className="mt-2 text-sm font-medium" style={{ color: primaryColor }}>
            {statusLabel || (heating ? 'Heating' : 'Idle')}
          </p>
          <p className="mt-4 text-sm text-white/80">{roomName || ''}</p>
        </div>
      </div>

      <div className="relative mt-5 h-10">
        <div className="absolute left-0 right-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-white/18" />
        <div
          className="absolute left-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full"
          style={{ width: `${ratio * 100}%`, backgroundColor: primaryColor }}
        />
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 shadow-[0_0_0_8px_rgba(103,251,255,0.12)]"
          style={{ left: `${ratio * 100}%`, backgroundColor: primaryColor }}
        />
        <input
          aria-label="Temperature dial"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}
