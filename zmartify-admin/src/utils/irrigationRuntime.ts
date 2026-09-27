interface IrrigationRuntimeActivity {
  active_program_name?: string | null;
  active_zone_id?: number | null;
  remaining_seconds?: number | null;
}

export const isIrrigationRuntimeActive = (runtime?: IrrigationRuntimeActivity | null): boolean => Boolean(
  runtime?.active_program_name
  || (runtime?.active_zone_id != null && runtime.active_zone_id > 0)
  || (runtime?.remaining_seconds != null && runtime.remaining_seconds > 0),
);