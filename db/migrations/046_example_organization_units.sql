WITH city_seed(organization_name, city_name, address) AS (
  VALUES
    ('BioSave', 'Москва', 'Московский городской контур'),
    ('BioSave', 'Санкт-Петербург', 'Санкт-Петербургский городской контур'),
    ('ТехСтройИнвест', 'Москва', 'Московский городской контур'),
    ('ТехСтройИнвест', 'Казань', 'Казанский городской контур')
)
INSERT INTO organization_units (organization_id, unit_kind, name, address)
SELECT organizations.id, 'city', city_seed.city_name, city_seed.address
FROM city_seed
JOIN organizations
  ON organizations.name = city_seed.organization_name
 AND organizations.organization_kind = 'company'
ON CONFLICT DO NOTHING;

WITH area_seed(organization_name, city_name, area_name, address) AS (
  VALUES
    ('BioSave', 'Москва', 'Центр', 'ЦАО и прилегающие районы'),
    ('BioSave', 'Москва', 'Юг', 'ЮАО и ЮЗАО'),
    ('BioSave', 'Санкт-Петербург', 'Север', 'Выборгский и Калининский районы'),
    ('ТехСтройИнвест', 'Москва', 'Юг', 'ЮАО и промышленные зоны юга Москвы'),
    ('ТехСтройИнвест', 'Москва', 'Север', 'САО и СВАО'),
    ('ТехСтройИнвест', 'Казань', 'Центр', 'Вахитовский и Приволжский районы')
)
INSERT INTO organization_units (
  organization_id,
  parent_unit_id,
  unit_kind,
  name,
  address
)
SELECT
  organizations.id,
  cities.id,
  'area',
  area_seed.area_name,
  area_seed.address
FROM area_seed
JOIN organizations
  ON organizations.name = area_seed.organization_name
 AND organizations.organization_kind = 'company'
JOIN organization_units cities
  ON cities.organization_id = organizations.id
 AND cities.unit_kind = 'city'
 AND lower(cities.name) = lower(area_seed.city_name)
ON CONFLICT DO NOTHING;
