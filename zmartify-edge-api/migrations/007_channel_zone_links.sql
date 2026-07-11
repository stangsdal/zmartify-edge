ALTER TABLE channel_metadata ADD COLUMN linked_zone_ids_json TEXT;

UPDATE channel_metadata
SET linked_zone_ids_json = '[]'
WHERE linked_zone_ids_json IS NULL;

CREATE INDEX IF NOT EXISTS idx_channel_metadata_device_sort
ON channel_metadata(device_id, sort_order, channel_id);
