ALTER TABLE nilan_hvac_state ADD COLUMN inlet_speed INTEGER;
ALTER TABLE nilan_hvac_state ADD COLUMN exhaust_speed INTEGER;
ALTER TABLE nilan_hvac_state ADD COLUMN run_set INTEGER;
ALTER TABLE nilan_hvac_state ADD COLUMN mode_set INTEGER;
ALTER TABLE nilan_hvac_state ADD COLUMN vent_set INTEGER;
ALTER TABLE nilan_hvac_state ADD COLUMN temp_set DOUBLE PRECISION;
ALTER TABLE nilan_hvac_state ADD COLUMN service_mode INTEGER;
ALTER TABLE nilan_hvac_state ADD COLUMN service_pct INTEGER;
