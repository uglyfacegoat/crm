ALTER TABLE website_health_snapshots
  ADD COLUMN memory_capacity_mb integer CHECK (memory_capacity_mb IS NULL OR memory_capacity_mb > 0),
  ADD COLUMN disk_capacity_mb integer CHECK (disk_capacity_mb IS NULL OR disk_capacity_mb > 0),
  ADD COLUMN ssl_expires_on date;
