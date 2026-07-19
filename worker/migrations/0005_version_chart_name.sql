ALTER TABLE versions ADD COLUMN chart_name TEXT;
ALTER TABLE versions ADD COLUMN normalized_chart_name TEXT;

UPDATE versions
SET
  chart_name = (
    SELECT charts.chart_name
    FROM charts
    WHERE charts.id = versions.chart_id
  ),
  normalized_chart_name = (
    SELECT charts.normalized_chart_name
    FROM charts
    WHERE charts.id = versions.chart_id
  )
WHERE chart_name IS NULL
   OR normalized_chart_name IS NULL;
