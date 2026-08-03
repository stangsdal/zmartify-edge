import { IrrigationZoneRunStatus } from '../hooks/useIrrigationRunState';

interface IrrigationZoneActionControlProps {
  status?: IrrigationZoneRunStatus;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function IrrigationZoneActionControl({
  status = 'idle',
  disabled = false,
  onStart,
  onStop,
}: IrrigationZoneActionControlProps) {
  if (status === 'starting' || status === 'stopping') {
    return (
      <button type="button" className="rounded-xl bg-amber-600 text-white px-4 py-2 text-sm font-semibold opacity-60" disabled>
        {status === 'stopping' ? 'Stopping...' : 'Starting...'}
      </button>
    );
  }

  if (status === 'running') {
    return (
      <button
        type="button"
        className="rounded-xl bg-rose-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
        disabled={disabled}
        onClick={onStop}
      >
        Stop zone
      </button>
    );
  }

  return (
    <button
      type="button"
      className="rounded-xl bg-teal-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
      disabled={disabled}
      onClick={onStart}
    >
      Start zone
    </button>
  );
}