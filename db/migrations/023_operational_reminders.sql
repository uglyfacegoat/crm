CREATE INDEX service_visits_missing_closing_act_idx
  ON service_visits (organization_id, scheduled_end_at)
  WHERE status IN ('planned', 'confirmed', 'in_progress') AND completion_document_id IS NULL;

CREATE OR REPLACE FUNCTION provision_chat_operational_reminders(
  requested_organization_id uuid DEFAULT NULL,
  requested_actor_id uuid DEFAULT NULL,
  requested_session_id uuid DEFAULT NULL
)
RETURNS TABLE (
  channels_created bigint,
  members_added bigint,
  visit_messages_upserted bigint,
  closing_act_messages_upserted bigint,
  contract_messages_upserted bigint,
  obsolete_messages_removed bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  organization_record record;
  owner_member_id uuid;
  general_channel_id uuid;
  affected_rows bigint;
  changed_messages bigint;
BEGIN
  channels_created := 0;
  members_added := 0;
  visit_messages_upserted := 0;
  closing_act_messages_upserted := 0;
  contract_messages_upserted := 0;
  obsolete_messages_removed := 0;

  FOR organization_record IN
    SELECT organizations.id, organizations.timezone
    FROM organizations
    WHERE requested_organization_id IS NULL OR organizations.id = requested_organization_id
  LOOP
    owner_member_id := NULL;
    SELECT members.id
    INTO owner_member_id
    FROM organization_members members
    WHERE members.organization_id = organization_record.id
      AND members.active
      AND members.role <> 'master'
    ORDER BY
      CASE WHEN members.id = requested_actor_id THEN 0 ELSE 1 END,
      CASE members.role WHEN 'admin' THEN 0 WHEN 'dispatcher' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END,
      members.created_at,
      members.id
    LIMIT 1;

    IF owner_member_id IS NULL THEN
      CONTINUE;
    END IF;

    general_channel_id := NULL;
    INSERT INTO chat_channels (organization_id, name, description, kind, created_by)
    VALUES (organization_record.id, 'Общий чат', 'Главный рабочий канал офиса', 'general', owner_member_id)
    ON CONFLICT DO NOTHING
    RETURNING id INTO general_channel_id;

    IF general_channel_id IS NOT NULL THEN
      channels_created := channels_created + 1;
      INSERT INTO audit_events (
        organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes
      ) VALUES (
        organization_record.id,
        owner_member_id,
        CASE WHEN owner_member_id = requested_actor_id THEN requested_session_id ELSE NULL END,
        'chat.channel.provisioned',
        'chat_channel',
        general_channel_id,
        jsonb_build_object('source', CASE WHEN requested_actor_id IS NULL THEN 'reminder_worker' ELSE 'chat_workspace' END)
      );
    ELSE
      SELECT channels.id
      INTO general_channel_id
      FROM chat_channels channels
      WHERE channels.organization_id = organization_record.id
        AND channels.kind = 'general'
        AND channels.archived_at IS NULL
      LIMIT 1;
    END IF;

    IF general_channel_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO chat_channel_members AS existing_members (
      organization_id, channel_id, member_id, channel_role, joined_by
    )
    SELECT
      members.organization_id,
      general_channel_id,
      members.id,
      CASE WHEN members.id = owner_member_id THEN 'owner' ELSE 'member' END,
      owner_member_id
    FROM organization_members members
    WHERE members.organization_id = organization_record.id
      AND members.active
      AND members.role <> 'master'
    ON CONFLICT (organization_id, channel_id, member_id) DO UPDATE
      SET channel_role = EXCLUDED.channel_role
      WHERE existing_members.channel_role IS DISTINCT FROM EXCLUDED.channel_role;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    members_added := members_added + affected_rows;

    changed_messages := 0;
    WITH upserted_messages AS (
      INSERT INTO chat_messages AS existing_messages (
        id, organization_id, channel_id, author_id, body, message_kind, system_event_key, system_payload
      )
      SELECT
        gen_random_uuid(),
        visits.organization_id,
        general_channel_id,
        NULL,
        'Завтра в ' || to_char(visits.scheduled_start_at AT TIME ZONE organization_record.timezone, 'HH24:MI') ||
          ' выезд по заказу №' || orders.order_number || E'\n' || orders.client_name_snapshot || ' · ' ||
          orders.object_name_snapshot || E'\n' || orders.object_address_snapshot,
        'system',
        'visit_tomorrow:' || visits.id::text || ':' ||
          (visits.scheduled_start_at AT TIME ZONE organization_record.timezone)::date::text,
        jsonb_build_object('visitId', visits.id, 'orderId', orders.id, 'scheduledStartAt', visits.scheduled_start_at)
      FROM service_visits visits
      JOIN orders ON orders.organization_id = visits.organization_id AND orders.id = visits.order_id
      WHERE visits.organization_id = organization_record.id
        AND visits.status IN ('planned', 'confirmed')
        AND (visits.scheduled_start_at AT TIME ZONE organization_record.timezone)::date =
          (now() AT TIME ZONE organization_record.timezone)::date + 1
      ON CONFLICT (organization_id, system_event_key)
        WHERE system_event_key IS NOT NULL AND deleted_at IS NULL
      DO UPDATE SET body = EXCLUDED.body, system_payload = EXCLUDED.system_payload
      WHERE existing_messages.body IS DISTINCT FROM EXCLUDED.body
        OR existing_messages.system_payload IS DISTINCT FROM EXCLUDED.system_payload
      RETURNING id
    )
    SELECT count(*) INTO affected_rows FROM upserted_messages;
    visit_messages_upserted := visit_messages_upserted + affected_rows;
    changed_messages := changed_messages + affected_rows;

    WITH upserted_messages AS (
      INSERT INTO chat_messages AS existing_messages (
        id, organization_id, channel_id, author_id, body, message_kind, system_event_key, system_payload
      )
      SELECT
        gen_random_uuid(),
        visits.organization_id,
        general_channel_id,
        NULL,
        'Не закрыт акт по выезду ' ||
          to_char(visits.scheduled_start_at AT TIME ZONE organization_record.timezone, 'DD.MM.YYYY HH24:MI') ||
          ' · заказ №' || orders.order_number || E'\n' || orders.client_name_snapshot || ' · ' ||
          orders.object_name_snapshot || E'\n' || orders.object_address_snapshot,
        'system',
        'closing_act_overdue:' || visits.id::text,
        jsonb_build_object(
          'visitId', visits.id,
          'orderId', orders.id,
          'scheduledStartAt', visits.scheduled_start_at,
          'scheduledEndAt', visits.scheduled_end_at
        )
      FROM service_visits visits
      JOIN orders ON orders.organization_id = visits.organization_id AND orders.id = visits.order_id
      WHERE visits.organization_id = organization_record.id
        AND visits.status IN ('planned', 'confirmed', 'in_progress')
        AND visits.completion_document_id IS NULL
        AND visits.scheduled_end_at < now()
      ON CONFLICT (organization_id, system_event_key)
        WHERE system_event_key IS NOT NULL AND deleted_at IS NULL
      DO UPDATE SET body = EXCLUDED.body, system_payload = EXCLUDED.system_payload
      WHERE existing_messages.body IS DISTINCT FROM EXCLUDED.body
        OR existing_messages.system_payload IS DISTINCT FROM EXCLUDED.system_payload
      RETURNING id
    )
    SELECT count(*) INTO affected_rows FROM upserted_messages;
    closing_act_messages_upserted := closing_act_messages_upserted + affected_rows;
    changed_messages := changed_messages + affected_rows;

    WITH upserted_messages AS (
      INSERT INTO chat_messages AS existing_messages (
        id, organization_id, channel_id, author_id, body, message_kind, system_event_key, system_payload
      )
      SELECT
        gen_random_uuid(),
        contracts.organization_id,
        general_channel_id,
        NULL,
        CASE
          WHEN contracts.ends_on < (now() AT TIME ZONE organization_record.timezone)::date
            THEN 'Срок договора №' || contracts.contract_number || ' истёк ' || to_char(contracts.ends_on, 'DD.MM.YYYY')
          ELSE 'Договор №' || contracts.contract_number || ' заканчивается ' || to_char(contracts.ends_on, 'DD.MM.YYYY')
        END || E'\n' || clients.legal_name || ' · ' || client_objects.name || E'\n' || client_objects.address,
        'system',
        'contract_renewal:' || contracts.id::text || ':' || contracts.ends_on::text,
        jsonb_build_object(
          'contractId', contracts.id,
          'clientId', clients.id,
          'objectId', client_objects.id,
          'endsOn', contracts.ends_on,
          'renewalNoticeDays', contracts.renewal_notice_days
        )
      FROM contracts
      JOIN clients ON clients.organization_id = contracts.organization_id AND clients.id = contracts.client_id
      JOIN client_objects ON client_objects.organization_id = contracts.organization_id AND client_objects.id = contracts.object_id
      WHERE contracts.organization_id = organization_record.id
        AND contracts.status = 'active'
        AND contracts.ends_on <= (now() AT TIME ZONE organization_record.timezone)::date + contracts.renewal_notice_days
      ON CONFLICT (organization_id, system_event_key)
        WHERE system_event_key IS NOT NULL AND deleted_at IS NULL
      DO UPDATE SET body = EXCLUDED.body, system_payload = EXCLUDED.system_payload
      WHERE existing_messages.body IS DISTINCT FROM EXCLUDED.body
        OR existing_messages.system_payload IS DISTINCT FROM EXCLUDED.system_payload
      RETURNING id
    )
    SELECT count(*) INTO affected_rows FROM upserted_messages;
    contract_messages_upserted := contract_messages_upserted + affected_rows;
    changed_messages := changed_messages + affected_rows;

    UPDATE chat_messages messages
    SET deleted_at = now()
    WHERE messages.organization_id = organization_record.id
      AND messages.channel_id = general_channel_id
      AND messages.message_kind = 'system'
      AND messages.deleted_at IS NULL
      AND messages.system_event_key LIKE 'visit_tomorrow:%'
      AND substring(messages.system_event_key FROM '([0-9]{4}-[0-9]{2}-[0-9]{2})$') IS NOT NULL
      AND substring(messages.system_event_key FROM '([0-9]{4}-[0-9]{2}-[0-9]{2})$')::date >=
        (now() AT TIME ZONE organization_record.timezone)::date
      AND NOT EXISTS (
        SELECT 1 FROM service_visits visits
        WHERE visits.organization_id = organization_record.id
          AND visits.id::text = messages.system_payload->>'visitId'
          AND visits.status IN ('planned', 'confirmed')
          AND (visits.scheduled_start_at AT TIME ZONE organization_record.timezone)::date =
            substring(messages.system_event_key FROM '([0-9]{4}-[0-9]{2}-[0-9]{2})$')::date
      );
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    obsolete_messages_removed := obsolete_messages_removed + affected_rows;
    changed_messages := changed_messages + affected_rows;

    UPDATE chat_messages messages
    SET deleted_at = now()
    WHERE messages.organization_id = organization_record.id
      AND messages.channel_id = general_channel_id
      AND messages.message_kind = 'system'
      AND messages.deleted_at IS NULL
      AND messages.system_event_key LIKE 'closing_act_overdue:%'
      AND NOT EXISTS (
        SELECT 1 FROM service_visits visits
        WHERE visits.organization_id = organization_record.id
          AND visits.id::text = messages.system_payload->>'visitId'
          AND visits.status IN ('planned', 'confirmed', 'in_progress')
          AND visits.completion_document_id IS NULL
          AND visits.scheduled_end_at < now()
      );
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    obsolete_messages_removed := obsolete_messages_removed + affected_rows;
    changed_messages := changed_messages + affected_rows;

    UPDATE chat_messages messages
    SET deleted_at = now()
    WHERE messages.organization_id = organization_record.id
      AND messages.channel_id = general_channel_id
      AND messages.message_kind = 'system'
      AND messages.deleted_at IS NULL
      AND messages.system_event_key LIKE 'contract_renewal:%'
      AND NOT EXISTS (
        SELECT 1 FROM contracts
        WHERE contracts.organization_id = organization_record.id
          AND contracts.id::text = messages.system_payload->>'contractId'
          AND contracts.status = 'active'
          AND contracts.ends_on::text = messages.system_payload->>'endsOn'
          AND contracts.ends_on <= (now() AT TIME ZONE organization_record.timezone)::date + contracts.renewal_notice_days
      );
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    obsolete_messages_removed := obsolete_messages_removed + affected_rows;
    changed_messages := changed_messages + affected_rows;

    IF changed_messages > 0 THEN
      UPDATE chat_channels SET updated_at = now()
      WHERE organization_id = organization_record.id AND id = general_channel_id;
    END IF;
  END LOOP;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION provision_chat_visit_reminders(
  requested_organization_id uuid DEFAULT NULL,
  requested_actor_id uuid DEFAULT NULL,
  requested_session_id uuid DEFAULT NULL
)
RETURNS TABLE (
  channels_created bigint,
  members_added bigint,
  messages_upserted bigint,
  obsolete_messages_removed bigint
)
LANGUAGE sql
AS $$
  SELECT
    reminders.channels_created,
    reminders.members_added,
    reminders.visit_messages_upserted + reminders.closing_act_messages_upserted + reminders.contract_messages_upserted,
    reminders.obsolete_messages_removed
  FROM provision_chat_operational_reminders(requested_organization_id, requested_actor_id, requested_session_id) reminders;
$$;
