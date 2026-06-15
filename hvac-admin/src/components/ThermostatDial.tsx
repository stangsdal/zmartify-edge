import { useMemo } from 'react';

interface ThermostatDialProps {
  value: number;
  currentTemperature?: number | null;
  roomName?: string;
  statusLabel?: string;
  heating?: boolean;
  thermostatMode?: number | null;
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
  thermostatMode = null,
  min = 5,
  max = 35,
  step = 0.5,
  onChange,
}: ThermostatDialProps) {
  const ratio = useMemo(() => (value - min) / (max - min), [value, min, max]);
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const ringRadius = 128;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const measuredTemp = typeof currentTemperature === 'number' ? currentTemperature : value;
  const clampedMeasuredTemp = Math.max(min, Math.min(max, measuredTemp));
  const setpointRatio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const measuredRatio = Math.max(0, Math.min(1, (clampedMeasuredTemp - min) / (max - min)));
  const deltaRatio = Math.abs(setpointRatio - measuredRatio);
  const deltaArcLength = ringCircumference * deltaRatio;
  const deltaArcOffset = ringCircumference * Math.min(setpointRatio, measuredRatio);
  const primaryColor = heating ? '#FF6A2B' : '#67FBFF';
  const secondaryColor = heating ? '#ffb08f' : 'rgba(255,255,255,0.65)';
  const deltaColor = value >= measuredTemp ? '#FF8A4B' : '#67FBFF';
  const markerTemps = [5, 10, 15, 20, 25, 30, 35];
  const modeMap: Record<number, string> = {
    0: 'MANUAL',
    1: 'STANDBY',
    2: 'ECO',
    3: 'COMFORT',
  };
  const modeLabel =
    typeof thermostatMode === 'number' && thermostatMode in modeMap
      ? modeMap[thermostatMode]
      : heating
        ? 'COMFORT'
        : 'MANUAL';

  const tempToAngle = (temp: number): number => {
    const normalized = (temp - 20) / 15;
    return -90 + normalized * 150;
  };

  return (
    <div className="relative mx-auto w-full max-w-[360px] overflow-hidden rounded-[2rem] border border-white/10 hero-glow bg-[radial-gradient(circle_at_top,rgba(103,251,255,0.16),transparent_38%),linear-gradient(180deg,rgba(21,28,44,0.92),rgba(21,28,44,0.78))] p-5 text-white shadow-2xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(103,251,255,0.16),transparent_25%),radial-gradient(circle_at_82%_20%,rgba(255,106,43,0.18),transparent_28%)]" />

      <div className="relative flex items-center justify-between text-xs uppercase tracking-[0.28em] text-white/70">
        <span>{roomName || 'Thermostat'}</span>
        <span>{heating ? 'Heating' : statusLabel || 'Idle'}</span>
      </div>

      <div className="relative mt-3 flex justify-end">
        <span
          className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{
            color: heating ? '#FF6A2B' : '#8A94A6',
            backgroundColor: heating ? 'rgba(255,106,43,0.15)' : 'rgba(138,148,166,0.15)',
          }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: heating ? '#FF6A2B' : '#8A94A6' }}
          />
          {heating ? 'Heat ON' : 'Heat OFF'}
        </span>
      </div>

      <div className="relative mt-4 flex items-center justify-center">
        <svg viewBox="0 0 320 320" className="h-[268px] w-[268px]">
          <circle cx="160" cy="160" r={ringRadius} stroke="rgba(255,255,255,0.18)" strokeWidth="6" fill="none" />
          <circle
            cx="160"
            cy="160"
            r={ringRadius}
            stroke={deltaColor}
            strokeWidth="6"
            fill="none"
            strokeDasharray={`${ringCircumference}`}
            strokeDashoffset={`${ringCircumference - deltaArcLength + deltaArcOffset}`}
            strokeLinecap="round"
            transform="rotate(-90 160 160)"
            opacity={deltaArcLength > 0 ? 1 : 0}
          />
          {markerTemps.map((markerTemp) => {
            const angle = tempToAngle(markerTemp);
            const cos = Math.cos((angle * Math.PI) / 180);
            const sin = Math.sin((angle * Math.PI) / 180);
            return (
              <g key={markerTemp}>
                <line
                  x1={160 + 114 * cos}
                  y1={160 + 114 * sin}
                  x2={160 + 126 * cos}
                  y2={160 + 126 * sin}
                  stroke={markerTemp === 20 ? primaryColor : 'rgba(255,255,255,0.55)'}
                  strokeWidth={markerTemp === 20 ? 2.5 : 2}
                  strokeLinecap="round"
                />
                <text
                  x={160 + 143 * cos}
                  y={160 + 143 * sin + 4}
                  fill={markerTemp === 20 ? primaryColor : 'rgba(255,255,255,0.72)'}
                  fontSize="11"
                  fontWeight={markerTemp === 20 ? '700' : '500'}
                  textAnchor="middle"
                >
                  {markerTemp}
                </text>
              </g>
            );
          })}
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
          <p className="mt-2 text-xs font-medium uppercase tracking-[0.2em]" style={{ color: deltaColor }}>
            Mode {modeLabel}
          </p>
        </div>
      </div>

      <div className="relative mt-5 h-10">
        <div className="absolute left-0 right-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-white/18" />
        <div
          className="absolute left-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full"
          style={{ width: `${clampedRatio * 100}%`, backgroundColor: primaryColor }}
        />
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 shadow-[0_0_0_8px_rgba(103,251,255,0.12)]"
          style={{ left: `${clampedRatio * 100}%`, backgroundColor: primaryColor }}
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
