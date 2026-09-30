CREATE TABLE catalog_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  symbol text NOT NULL CHECK (length(btrim(symbol)) BETWEEN 1 AND 40),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, symbol)
);

INSERT INTO catalog_units (organization_id, symbol, label)
SELECT org.id, unit.symbol, unit.label
FROM organizations AS org CROSS JOIN (VALUES
  ('усл.', 'услуга'), ('шт.', 'штука'), ('м²', 'квадратный метр'),
  ('км²', 'квадратный километр'), ('м', 'метр'), ('км', 'километр'),
  ('час', 'час'), ('день', 'день'), ('л', 'литр'), ('кг', 'килограмм'),
  ('компл.', 'комплект'), ('выезд', 'выезд')
) AS unit(symbol, label)
ON CONFLICT (organization_id, symbol) DO NOTHING;

INSERT INTO catalog_units (organization_id, symbol, label)
SELECT DISTINCT organization_id, unit, unit FROM catalog_items
ON CONFLICT (organization_id, symbol) DO NOTHING;

CREATE FUNCTION seed_catalog_units_for_organization() RETURNS trigger AS $$
BEGIN
  INSERT INTO catalog_units (organization_id, symbol, label)
  SELECT NEW.id, symbol, label FROM (VALUES
    ('усл.', 'услуга'), ('шт.', 'штука'), ('м²', 'квадратный метр'),
    ('км²', 'квадратный километр'), ('м', 'метр'), ('км', 'километр'),
    ('час', 'час'), ('день', 'день'), ('л', 'литр'), ('кг', 'килограмм'),
    ('компл.', 'комплект'), ('выезд', 'выезд')
  ) AS unit(symbol, label);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER organizations_seed_catalog_units AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION seed_catalog_units_for_organization();

INSERT INTO catalog_items (organization_id, kind, name, description, unit, price_mode, default_price_minor)
SELECT org.id, 'service', example.name, example.description, example.unit, 'variable', NULL
FROM organizations AS org CROSS JOIN (VALUES
  ('ТЕСТ · Дезинфекция помещения', 'Пример услуги с ценой за площадь; замените условия перед использованием.', 'м²'),
  ('ТЕСТ · Дератизация объекта', 'Пример услуги с переменной ценой.', 'м²'),
  ('ТЕСТ · Контрольный выезд', 'Пример услуги с ценой за выезд.', 'выезд')
) AS example(name, description, unit)
WHERE org.organization_kind = 'center'
ON CONFLICT DO NOTHING;
