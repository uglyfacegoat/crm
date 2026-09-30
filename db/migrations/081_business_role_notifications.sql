-- Align mail and operational notifications with the business-role grants.
CREATE OR REPLACE FUNCTION queue_website_lead_mail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO mail_delivery_jobs (organization_id, destination_id, source_type, source_id)
    SELECT DISTINCT NEW.organization_id, destination.id, 'lead', NEW.id
    FROM mail_sources source
    JOIN member_mail_source_subscriptions subscription
      ON subscription.organization_id = source.organization_id AND subscription.source_id = source.id
    JOIN member_mail_destinations destination
      ON destination.organization_id = subscription.organization_id AND destination.id = subscription.destination_id
    JOIN organization_members member
      ON member.organization_id = destination.organization_id AND member.id = destination.member_id
    WHERE source.organization_id = NEW.organization_id AND source.website_id = NEW.website_id
      AND source.active AND subscription.leads_enabled AND destination.leads_enabled
      AND destination.verified_at IS NOT NULL AND member.active
      AND coalesce((SELECT allowed FROM member_permission_overrides override
        WHERE override.organization_id = member.organization_id AND override.member_id = member.id
          AND override.permission = 'leads.read'),
        member.role IN ('admin', 'manager', 'dispatcher', 'accountant', 'deputy', 'finance_controller', 'sales_lead', 'regional_director', 'crm_coordinator', 'tender_specialist'));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION queue_incoming_mail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO mail_delivery_jobs (organization_id, destination_id, source_type, source_id)
    SELECT NEW.organization_id, destination.id, 'mail', NEW.id
    FROM mail_sources source
    JOIN member_mail_source_subscriptions subscription
      ON subscription.organization_id = source.organization_id AND subscription.source_id = source.id
    JOIN member_mail_destinations destination
      ON destination.organization_id = subscription.organization_id AND destination.id = subscription.destination_id
    JOIN organization_members member
      ON member.organization_id = destination.organization_id AND member.id = destination.member_id
    WHERE source.organization_id = NEW.organization_id AND source.id = NEW.source_id AND source.active
      AND subscription.mail_enabled AND destination.mail_enabled
      AND destination.verified_at IS NOT NULL AND member.active
      AND coalesce((SELECT allowed FROM member_permission_overrides override
        WHERE override.organization_id = member.organization_id AND override.member_id = member.id
          AND override.permission = 'leads.read'),
        member.role IN ('admin', 'manager', 'dispatcher', 'accountant', 'deputy', 'finance_controller', 'sales_lead', 'regional_director', 'crm_coordinator', 'tender_specialist'));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION provision_operational_notifications(
  requested_organization_id uuid DEFAULT NULL
)
RETURNS TABLE (
  visit_notifications_upserted bigint,
  unassigned_notifications_upserted bigint,
  closing_act_notifications_upserted bigint,
  task_notifications_upserted bigint,
  contract_notifications_upserted bigint,
  notifications_resolved bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  organization_record record;
  affected_rows bigint;
BEGIN
  visit_notifications_upserted := 0;
  unassigned_notifications_upserted := 0;
  closing_act_notifications_upserted := 0;
  task_notifications_upserted := 0;
  contract_notifications_upserted := 0;
  notifications_resolved := 0;

  FOR organization_record IN
    SELECT organizations.id, organizations.timezone
    FROM organizations
    WHERE requested_organization_id IS NULL OR organizations.id = requested_organization_id
  LOOP
    WITH upserted AS (
      INSERT INTO notifications AS existing (
        organization_id, recipient_member_id, kind, severity, title, body,
        source_type, source_id, target_type, target_id, event_key, occurred_at
      )
      SELECT
        visits.organization_id,
        recipients.id,
        'visit_upcoming',
        'info',
        'Выезд завтра в ' || to_char(visits.scheduled_start_at AT TIME ZONE organization_record.timezone, 'HH24:MI'),
        'Заказ №' || orders.order_number || ' · ' || orders.client_name_snapshot || E'\n' || orders.object_address_snapshot,
        'visit',
        visits.id,
        'order',
        orders.id,
        'visit_upcoming:' || visits.id::text || ':' ||
          (visits.scheduled_start_at AT TIME ZONE organization_record.timezone)::date::text,
        visits.scheduled_start_at
      FROM service_visits visits
      JOIN orders ON orders.organization_id = visits.organization_id AND orders.id = visits.order_id
      JOIN organization_members recipients ON recipients.organization_id = visits.organization_id
        AND recipients.active
        AND (
          recipients.role IN ('admin', 'dispatcher', 'manager', 'deputy', 'sales_lead', 'regional_director', 'crm_coordinator')
          OR (recipients.role IN ('master', 'foreman') AND recipients.master_id = visits.assigned_master_id)
        )
      WHERE visits.organization_id = organization_record.id
        AND visits.status IN ('planned', 'confirmed')
        AND (visits.scheduled_start_at AT TIME ZONE organization_record.timezone)::date =
          (now() AT TIME ZONE organization_record.timezone)::date + 1
      ON CONFLICT (organization_id, recipient_member_id, event_key) DO UPDATE SET
        severity = EXCLUDED.severity,
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        target_type = EXCLUDED.target_type,
        target_id = EXCLUDED.target_id,
        occurred_at = EXCLUDED.occurred_at,
        resolved_at = NULL,
        updated_at = now()
      WHERE existing.severity IS DISTINCT FROM EXCLUDED.severity
        OR existing.title IS DISTINCT FROM EXCLUDED.title
        OR existing.body IS DISTINCT FROM EXCLUDED.body
        OR existing.target_type IS DISTINCT FROM EXCLUDED.target_type
        OR existing.target_id IS DISTINCT FROM EXCLUDED.target_id
        OR existing.occurred_at IS DISTINCT FROM EXCLUDED.occurred_at
        OR existing.resolved_at IS NOT NULL
      RETURNING id
    )
    SELECT count(*) INTO affected_rows FROM upserted;
    visit_notifications_upserted := visit_notifications_upserted + affected_rows;

    WITH upserted AS (
      INSERT INTO notifications AS existing (
        organization_id, recipient_member_id, kind, severity, title, body,
        source_type, source_id, target_type, target_id, event_key, occurred_at
      )
      SELECT
        visits.organization_id,
        recipients.id,
        'visit_unassigned',
        'warning',
        'На выезд не назначен мастер',
        to_char(visits.scheduled_start_at AT TIME ZONE organization_record.timezone, 'DD.MM.YYYY HH24:MI') ||
          ' · заказ №' || orders.order_number || E'\n' || orders.client_name_snapshot || ' · ' || orders.object_address_snapshot,
        'visit',
        visits.id,
        'order',
        orders.id,
        'visit_unassigned:' || visits.id::text || ':' || to_char(visits.scheduled_start_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
        visits.scheduled_start_at
      FROM service_visits visits
      JOIN orders ON orders.organization_id = visits.organization_id AND orders.id = visits.order_id
      JOIN organization_members recipients ON recipients.organization_id = visits.organization_id
        AND recipients.active AND recipients.role IN ('admin', 'dispatcher', 'sales_lead', 'regional_director', 'crm_coordinator')
      WHERE visits.organization_id = organization_record.id
        AND visits.status IN ('planned', 'confirmed')
        AND visits.assigned_master_id IS NULL
        AND visits.scheduled_start_at >= now()
        AND visits.scheduled_start_at < now() + interval '7 days'
      ON CONFLICT (organization_id, recipient_member_id, event_key) DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        target_type = EXCLUDED.target_type,
        target_id = EXCLUDED.target_id,
        occurred_at = EXCLUDED.occurred_at,
        resolved_at = NULL,
        updated_at = now()
      WHERE existing.title IS DISTINCT FROM EXCLUDED.title
        OR existing.body IS DISTINCT FROM EXCLUDED.body
        OR existing.target_type IS DISTINCT FROM EXCLUDED.target_type
        OR existing.target_id IS DISTINCT FROM EXCLUDED.target_id
        OR existing.occurred_at IS DISTINCT FROM EXCLUDED.occurred_at
        OR existing.resolved_at IS NOT NULL
      RETURNING id
    )
    SELECT count(*) INTO affected_rows FROM upserted;
    unassigned_notifications_upserted := unassigned_notifications_upserted + affected_rows;

    WITH upserted AS (
      INSERT INTO notifications AS existing (
        organization_id, recipient_member_id, kind, severity, title, body,
        source_type, source_id, target_type, target_id, event_key, occurred_at
      )
      SELECT
        visits.organization_id,
        recipients.id,
        'closing_act_overdue',
        'critical',
        'Нет закрывающего акта',
        'Заказ №' || orders.order_number || ' · выезд ' ||
          to_char(visits.scheduled_start_at AT TIME ZONE organization_record.timezone, 'DD.MM.YYYY HH24:MI') || E'\n' ||
          orders.client_name_snapshot || ' · ' || orders.object_address_snapshot,
        'visit',
        visits.id,
        'order',
        orders.id,
        'closing_act_overdue:' || visits.id::text,
        visits.scheduled_end_at
      FROM service_visits visits
      JOIN orders ON orders.organization_id = visits.organization_id AND orders.id = visits.order_id
      JOIN organization_members recipients ON recipients.organization_id = visits.organization_id
        AND recipients.active
        AND (
          recipients.role IN ('admin', 'dispatcher', 'manager', 'deputy', 'sales_lead', 'regional_director', 'crm_coordinator')
          OR (recipients.role IN ('master', 'foreman') AND recipients.master_id = visits.assigned_master_id)
        )
      WHERE visits.organization_id = organization_record.id
        AND visits.status IN ('planned', 'confirmed', 'in_progress')
        AND visits.completion_document_id IS NULL
        AND visits.scheduled_end_at < now()
      ON CONFLICT (organization_id, recipient_member_id, event_key) DO UPDATE SET
        severity = EXCLUDED.severity,
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        target_type = EXCLUDED.target_type,
        target_id = EXCLUDED.target_id,
        occurred_at = EXCLUDED.occurred_at,
        resolved_at = NULL,
        updated_at = now()
      WHERE existing.severity IS DISTINCT FROM EXCLUDED.severity
        OR existing.title IS DISTINCT FROM EXCLUDED.title
        OR existing.body IS DISTINCT FROM EXCLUDED.body
        OR existing.target_type IS DISTINCT FROM EXCLUDED.target_type
        OR existing.target_id IS DISTINCT FROM EXCLUDED.target_id
        OR existing.occurred_at IS DISTINCT FROM EXCLUDED.occurred_at
        OR existing.resolved_at IS NOT NULL
      RETURNING id
    )
    SELECT count(*) INTO affected_rows FROM upserted;
    closing_act_notifications_upserted := closing_act_notifications_upserted + affected_rows;

    WITH upserted AS (
      INSERT INTO notifications AS existing (
        organization_id, recipient_member_id, kind, severity, title, body,
        source_type, source_id, target_type, target_id, event_key, occurred_at
      )
      SELECT
        tasks.organization_id,
        recipients.id,
        'task_overdue',
        CASE WHEN tasks.priority = 'critical' THEN 'critical' ELSE 'warning' END,
        'Просрочена задача',
        tasks.title || CASE WHEN orders.order_number IS NULL THEN '' ELSE E'\nЗаказ №' || orders.order_number END,
        'task',
        tasks.id,
        CASE WHEN tasks.related_order_id IS NULL THEN 'task' ELSE 'order' END,
        coalesce(tasks.related_order_id, tasks.id),
        'task_overdue:' || tasks.id::text || ':' || to_char(tasks.due_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
        tasks.due_at
      FROM tasks
      LEFT JOIN orders ON orders.organization_id = tasks.organization_id AND orders.id = tasks.related_order_id
      JOIN organization_members recipients ON recipients.organization_id = tasks.organization_id
        AND recipients.active
        AND (
          recipients.id = tasks.assigned_member_id
          OR (tasks.assigned_member_id IS NULL AND recipients.role IN ('admin', 'dispatcher', 'manager', 'deputy', 'sales_lead', 'regional_director', 'crm_coordinator'))
        )
      WHERE tasks.organization_id = organization_record.id
        AND tasks.status = 'open'
        AND tasks.due_at < now()
      ON CONFLICT (organization_id, recipient_member_id, event_key) DO UPDATE SET
        severity = EXCLUDED.severity,
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        target_type = EXCLUDED.target_type,
        target_id = EXCLUDED.target_id,
        occurred_at = EXCLUDED.occurred_at,
        resolved_at = NULL,
        updated_at = now()
      WHERE existing.severity IS DISTINCT FROM EXCLUDED.severity
        OR existing.title IS DISTINCT FROM EXCLUDED.title
        OR existing.body IS DISTINCT FROM EXCLUDED.body
        OR existing.target_type IS DISTINCT FROM EXCLUDED.target_type
        OR existing.target_id IS DISTINCT FROM EXCLUDED.target_id
        OR existing.occurred_at IS DISTINCT FROM EXCLUDED.occurred_at
        OR existing.resolved_at IS NOT NULL
      RETURNING id
    )
    SELECT count(*) INTO affected_rows FROM upserted;
    task_notifications_upserted := task_notifications_upserted + affected_rows;

    WITH upserted AS (
      INSERT INTO notifications AS existing (
        organization_id, recipient_member_id, kind, severity, title, body,
        source_type, source_id, target_type, target_id, event_key, occurred_at
      )
      SELECT
        contracts.organization_id,
        recipients.id,
        'contract_renewal',
        CASE WHEN contracts.ends_on < (now() AT TIME ZONE organization_record.timezone)::date THEN 'critical' ELSE 'warning' END,
        CASE
          WHEN contracts.ends_on < (now() AT TIME ZONE organization_record.timezone)::date THEN 'Договор просрочен'
          ELSE 'Пора продлить договор'
        END,
        'Договор №' || contracts.contract_number || ' · ' || clients.legal_name || E'\nСрок: ' || to_char(contracts.ends_on, 'DD.MM.YYYY'),
        'contract',
        contracts.id,
        'client',
        clients.id,
        'contract_renewal:' || contracts.id::text || ':' || contracts.ends_on::text,
        contracts.ends_on::timestamp AT TIME ZONE organization_record.timezone
      FROM contracts
      JOIN clients ON clients.organization_id = contracts.organization_id AND clients.id = contracts.client_id
      JOIN organization_members recipients ON recipients.organization_id = contracts.organization_id
        AND recipients.active AND recipients.role IN ('admin', 'manager', 'accountant', 'deputy', 'finance_controller', 'sales_lead', 'tender_specialist')
      WHERE contracts.organization_id = organization_record.id
        AND contracts.status = 'active'
        AND contracts.ends_on <= (now() AT TIME ZONE organization_record.timezone)::date + contracts.renewal_notice_days
      ON CONFLICT (organization_id, recipient_member_id, event_key) DO UPDATE SET
        severity = EXCLUDED.severity,
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        target_type = EXCLUDED.target_type,
        target_id = EXCLUDED.target_id,
        occurred_at = EXCLUDED.occurred_at,
        resolved_at = NULL,
        updated_at = now()
      WHERE existing.severity IS DISTINCT FROM EXCLUDED.severity
        OR existing.title IS DISTINCT FROM EXCLUDED.title
        OR existing.body IS DISTINCT FROM EXCLUDED.body
        OR existing.target_type IS DISTINCT FROM EXCLUDED.target_type
        OR existing.target_id IS DISTINCT FROM EXCLUDED.target_id
        OR existing.occurred_at IS DISTINCT FROM EXCLUDED.occurred_at
        OR existing.resolved_at IS NOT NULL
      RETURNING id
    )
    SELECT count(*) INTO affected_rows FROM upserted;
    contract_notifications_upserted := contract_notifications_upserted + affected_rows;

    UPDATE notifications notification
    SET resolved_at = now(), updated_at = now()
    WHERE notification.organization_id = organization_record.id
      AND notification.resolved_at IS NULL
      AND notification.kind IN (
        'visit_upcoming', 'visit_unassigned', 'closing_act_overdue', 'task_overdue', 'contract_renewal'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM organization_members recipient
        WHERE recipient.organization_id = notification.organization_id
          AND recipient.id = notification.recipient_member_id
          AND recipient.active
      )
      OR notification.organization_id = organization_record.id
        AND notification.resolved_at IS NULL
        AND notification.kind = 'visit_upcoming'
        AND NOT EXISTS (
          SELECT 1 FROM service_visits visit
          JOIN organization_members recipient ON recipient.organization_id = visit.organization_id
            AND recipient.id = notification.recipient_member_id
            AND recipient.active
            AND (
              recipient.role IN ('admin', 'dispatcher', 'manager', 'deputy', 'sales_lead', 'regional_director', 'crm_coordinator')
              OR (recipient.role IN ('master', 'foreman') AND recipient.master_id = visit.assigned_master_id)
            )
          WHERE visit.organization_id = notification.organization_id
            AND visit.id = notification.source_id
            AND visit.status IN ('planned', 'confirmed')
            AND (visit.scheduled_start_at AT TIME ZONE organization_record.timezone)::date =
              (now() AT TIME ZONE organization_record.timezone)::date + 1
            AND notification.event_key = 'visit_upcoming:' || visit.id::text || ':' ||
              (visit.scheduled_start_at AT TIME ZONE organization_record.timezone)::date::text
        )
      OR notification.organization_id = organization_record.id
        AND notification.resolved_at IS NULL
        AND notification.kind = 'visit_unassigned'
        AND NOT EXISTS (
          SELECT 1 FROM service_visits visit
          JOIN organization_members recipient ON recipient.organization_id = visit.organization_id
            AND recipient.id = notification.recipient_member_id
            AND recipient.active AND recipient.role IN ('admin', 'dispatcher', 'sales_lead', 'regional_director', 'crm_coordinator')
          WHERE visit.organization_id = notification.organization_id
            AND visit.id = notification.source_id
            AND visit.status IN ('planned', 'confirmed')
            AND visit.assigned_master_id IS NULL
            AND visit.scheduled_start_at >= now()
            AND visit.scheduled_start_at < now() + interval '7 days'
            AND notification.event_key = 'visit_unassigned:' || visit.id::text || ':' ||
              to_char(visit.scheduled_start_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')
        )
      OR notification.organization_id = organization_record.id
        AND notification.resolved_at IS NULL
        AND notification.kind = 'closing_act_overdue'
        AND NOT EXISTS (
          SELECT 1 FROM service_visits visit
          JOIN organization_members recipient ON recipient.organization_id = visit.organization_id
            AND recipient.id = notification.recipient_member_id
            AND recipient.active
            AND (
              recipient.role IN ('admin', 'dispatcher', 'manager', 'deputy', 'sales_lead', 'regional_director', 'crm_coordinator')
              OR (recipient.role IN ('master', 'foreman') AND recipient.master_id = visit.assigned_master_id)
            )
          WHERE visit.organization_id = notification.organization_id
            AND visit.id = notification.source_id
            AND visit.status IN ('planned', 'confirmed', 'in_progress')
            AND visit.completion_document_id IS NULL
            AND visit.scheduled_end_at < now()
        )
      OR notification.organization_id = organization_record.id
        AND notification.resolved_at IS NULL
        AND notification.kind = 'task_overdue'
        AND NOT EXISTS (
          SELECT 1 FROM tasks task
          JOIN organization_members recipient ON recipient.organization_id = task.organization_id
            AND recipient.id = notification.recipient_member_id
            AND recipient.active
            AND (
              recipient.id = task.assigned_member_id
              OR (task.assigned_member_id IS NULL AND recipient.role IN ('admin', 'dispatcher', 'manager', 'deputy', 'sales_lead', 'regional_director', 'crm_coordinator'))
            )
          WHERE task.organization_id = notification.organization_id
            AND task.id = notification.source_id
            AND task.status = 'open'
            AND task.due_at < now()
            AND notification.event_key = 'task_overdue:' || task.id::text || ':' ||
              to_char(task.due_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')
        )
      OR notification.organization_id = organization_record.id
        AND notification.resolved_at IS NULL
        AND notification.kind = 'contract_renewal'
        AND NOT EXISTS (
          SELECT 1 FROM contracts contract
          JOIN organization_members recipient ON recipient.organization_id = contract.organization_id
            AND recipient.id = notification.recipient_member_id
            AND recipient.active AND recipient.role IN ('admin', 'manager', 'accountant', 'deputy', 'finance_controller', 'sales_lead', 'tender_specialist')
          WHERE contract.organization_id = notification.organization_id
            AND contract.id = notification.source_id
            AND contract.status = 'active'
            AND contract.ends_on <= (now() AT TIME ZONE organization_record.timezone)::date + contract.renewal_notice_days
            AND notification.event_key = 'contract_renewal:' || contract.id::text || ':' || contract.ends_on::text
        );
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    notifications_resolved := notifications_resolved + affected_rows;
  END LOOP;

  RETURN NEXT;
END;
$$;
