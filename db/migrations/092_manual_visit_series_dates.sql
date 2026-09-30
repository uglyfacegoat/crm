ALTER TABLE service_visit_series DROP CONSTRAINT IF EXISTS service_visit_series_frequency_unit_check;
ALTER TABLE service_visit_series ADD CONSTRAINT service_visit_series_frequency_unit_check
  CHECK (frequency_unit IN ('week', 'month', 'custom'));
ALTER TABLE service_visit_series ADD COLUMN selected_dates date[];
ALTER TABLE service_visit_series ADD CONSTRAINT service_visit_series_selected_dates_check
  CHECK ((frequency_unit = 'custom' AND selected_dates IS NOT NULL AND cardinality(selected_dates) BETWEEN 1 AND 60)
      OR (frequency_unit <> 'custom' AND selected_dates IS NULL));
