DO $$
DECLARE
  center_organization_id uuid;
  yaroslav_member_id uuid;
  company record;
  shadow_member_id uuid;
BEGIN
  SELECT organizations.id INTO center_organization_id
  FROM organizations
  WHERE organization_kind = 'center'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO yaroslav_member_id
  FROM organization_members
  WHERE organization_id = center_organization_id
    AND email = 'yaroslav.crm@local.test'
    AND active
  LIMIT 1;

  IF center_organization_id IS NOT NULL AND yaroslav_member_id IS NOT NULL THEN
    FOR company IN
      SELECT id FROM organizations
      WHERE parent_organization_id = center_organization_id
        AND name IN ('ТехСтройИнвест', 'BioSave')
    LOOP
      INSERT INTO organization_members (organization_id, display_name, email, role, active)
      VALUES (company.id, 'Ярослав', 'yaroslav.crm@local.test', 'admin', true)
      ON CONFLICT (organization_id, email) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            role = 'admin',
            active = true,
            updated_at = now(),
            version = organization_members.version + 1
      RETURNING id INTO shadow_member_id;

      DELETE FROM organization_access_grants
      WHERE target_organization_id = company.id;

      INSERT INTO organization_access_grants (
        principal_organization_id,
        principal_member_id,
        target_organization_id,
        target_member_id
      ) VALUES (
        center_organization_id,
        yaroslav_member_id,
        company.id,
        shadow_member_id
      );
    END LOOP;
  END IF;

  UPDATE auth_sessions
  SET revoked_at = COALESCE(revoked_at, now())
  WHERE revoked_at IS NULL AND (
    member_id IN (SELECT id FROM organization_members WHERE email = 'admin@example.local')
    OR active_member_id IN (SELECT id FROM organization_members WHERE email = 'admin@example.local')
  );

  UPDATE organization_members
  SET active = false, updated_at = now(), version = version + 1
  WHERE email = 'admin@example.local' AND active;
END $$;

INSERT INTO website_leads (
  organization_id,
  website_id,
  external_event_id,
  received_at,
  contact_name,
  phone,
  email,
  service_interest,
  landing_url,
  referrer_url,
  utm_source,
  utm_medium,
  utm_campaign,
  payload_fingerprint
)
SELECT
  websites.organization_id,
  websites.id,
  example.external_event_id,
  example.received_at,
  example.contact_name,
  example.phone,
  example.email,
  example.service_interest,
  'https://' || websites.domain || example.path,
  example.referrer_url,
  example.utm_source,
  example.utm_medium,
  example.utm_campaign,
  encode(digest(example.external_event_id, 'sha256'), 'hex')
FROM websites
CROSS JOIN (VALUES
  ('demo-lead-office-2026-09-04', now() - interval '18 minutes', 'Анна Воронцова', '+7 916 420-18-07', 'anna.vorontsova@example.ru', 'Обработка офисного центра', '/services/office', 'https://yandex.ru/', 'yandex', 'cpc', 'office_moscow'),
  ('demo-lead-warehouse-2026-09-04', now() - interval '2 hours 12 minutes', 'Михаил Корнеев', '+7 903 177-42-81', 'm.korneev@example.ru', 'Дератизация складского комплекса', '/services/warehouse', 'https://google.com/', 'google', 'organic', NULL),
  ('demo-lead-cafe-2026-09-04', now() - interval '1 day 36 minutes', 'Елена Романова', '+7 985 630-09-14', 'elena.romanova@example.ru', 'Плановая дезинсекция кафе', '/services/cafe', NULL, 'direct', 'none', NULL)
) AS example(external_event_id, received_at, contact_name, phone, email, service_interest, path, referrer_url, utm_source, utm_medium, utm_campaign)
WHERE websites.organization_id = (
  SELECT id FROM organizations WHERE organization_kind = 'center' ORDER BY created_at, id LIMIT 1
)
ON CONFLICT (organization_id, website_id, external_event_id) DO NOTHING;

WITH selected_clients AS (
  SELECT
    clients.organization_id,
    clients.id AS client_id,
    client_objects.id AS object_id,
    row_number() OVER (ORDER BY clients.created_at, clients.id) AS position
  FROM clients
  JOIN client_objects
    ON client_objects.organization_id = clients.organization_id
   AND client_objects.client_id = clients.id
  WHERE clients.organization_id = (
    SELECT id FROM organizations WHERE organization_kind = 'center' ORDER BY created_at, id LIMIT 1
  )
), inserted_contracts AS (
  INSERT INTO contracts (
    organization_id,
    client_id,
    object_id,
    contract_number,
    status,
    starts_on,
    ends_on,
    renewal_notice_days,
    notes
  )
  SELECT
    organization_id,
    client_id,
    object_id,
    CASE position WHEN 1 THEN 'ДОГ-2026-001' ELSE 'ДОГ-2026-002' END,
    CASE position WHEN 1 THEN 'active' ELSE 'draft' END,
    CASE position WHEN 1 THEN DATE '2026-09-01' ELSE DATE '2026-10-01' END,
    CASE position WHEN 1 THEN DATE '2027-08-31' ELSE DATE '2027-03-31' END,
    CASE position WHEN 1 THEN 30 ELSE 14 END,
    CASE position WHEN 1 THEN 'Годовое обслуживание объекта по согласованному графику.' ELSE 'Черновик договора на сезонное обслуживание.' END
  FROM selected_clients
  WHERE position <= 2
  ON CONFLICT (organization_id, contract_number) DO NOTHING
  RETURNING id, organization_id, starts_on, ends_on, status, contract_number
)
INSERT INTO contract_schedule_rules (
  organization_id,
  contract_id,
  frequency_unit,
  frequency_interval,
  local_time,
  starts_on,
  ends_on,
  duration_minutes,
  notes
)
SELECT
  organization_id,
  id,
  'month',
  1,
  TIME '10:00',
  starts_on,
  ends_on,
  120,
  'Плановый выезд по договору'
FROM inserted_contracts;

INSERT INTO contract_events (organization_id, contract_id, event_type, after_state)
SELECT
  contracts.organization_id,
  contracts.id,
  'created',
  jsonb_build_object(
    'contractNumber', contracts.contract_number,
    'status', contracts.status,
    'startsOn', contracts.starts_on,
    'endsOn', contracts.ends_on,
    'renewalNoticeDays', contracts.renewal_notice_days,
    'version', contracts.version
  )
FROM contracts
WHERE contracts.contract_number IN ('ДОГ-2026-001', 'ДОГ-2026-002')
  AND NOT EXISTS (
    SELECT 1 FROM contract_events
    WHERE contract_events.organization_id = contracts.organization_id
      AND contract_events.contract_id = contracts.id
  );
