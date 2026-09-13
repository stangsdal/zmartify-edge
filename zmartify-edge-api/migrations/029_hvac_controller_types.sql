UPDATE devices
SET device_type = CASE
    WHEN LOWER(device_id) LIKE '%nilan%'
      OR LOWER(display_name) LIKE '%nilan%'
      OR LOWER(display_name) LIKE '%cts602%'
      OR LOWER(display_name) LIKE '%comfort 302%'
        THEN 'hvac_nilan'
    ELSE 'hvac_ahc9000'
END
WHERE product_type = 'hvac' OR device_type = 'hvac_gateway';