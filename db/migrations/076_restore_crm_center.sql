-- A restored single-company installation can lose the separate center while
-- keeping the developer's working company and all of its data. Restore the
-- center only for that precise layout; other installations are left alone.
DO $$
DECLARE
  company_id uuid;
  center_id uuid;
  company_member_id uuid;
  center_member_id uuid;
  company_timezone text;
  member_name text;
  member_email text;
  member_role text;
  identity_row record;
BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE organization_kind = 'center')
    OR (SELECT count(*) FROM organizations) <> 1 THEN
    RETURN;
  END IF;

  SELECT id, timezone INTO company_id, company_timezone
  FROM organizations WHERE organization_kind = 'company';

  SELECT members.id, members.display_name, members.email, members.role
    INTO company_member_id, member_name, member_email, member_role
  FROM organization_members members
  JOIN developer_accounts developers ON developers.email = members.email
  JOIN member_credentials credentials
    ON credentials.organization_id = members.organization_id
   AND credentials.member_id = members.id
  WHERE members.organization_id = company_id
    AND members.active AND members.deleted_at IS NULL
  LIMIT 1;

  IF company_member_id IS NULL
    OR (SELECT count(*) FROM organization_members members
        JOIN developer_accounts developers ON developers.email = members.email
        JOIN member_credentials credentials
          ON credentials.organization_id = members.organization_id
         AND credentials.member_id = members.id
        WHERE members.organization_id = company_id
          AND members.active AND members.deleted_at IS NULL) <> 1
    OR EXISTS (SELECT 1 FROM auth_sessions
               WHERE organization_id = company_id
                 AND active_organization_id IS NOT NULL) THEN
    RETURN;
  END IF;

  INSERT INTO organizations (name, timezone, organization_kind)
  VALUES ('Центр CRM', company_timezone, 'center') RETURNING id INTO center_id;
  UPDATE organizations
  SET parent_organization_id = center_id, updated_at = now()
  WHERE id = company_id;

  INSERT INTO organization_members
    (organization_id, display_name, email, role, active)
  VALUES (center_id, member_name, member_email, member_role, true)
  RETURNING id INTO center_member_id;

  INSERT INTO member_credentials
    (organization_id, member_id, password_hash, failed_login_attempts,
     locked_until, password_changed_at)
  SELECT center_id, center_member_id, password_hash, failed_login_attempts,
         locked_until, password_changed_at
  FROM member_credentials
  WHERE organization_id = company_id AND member_id = company_member_id;

  FOR identity_row IN
    SELECT kind, normalized_value, verified_at
    FROM member_login_identities
    WHERE organization_id = company_id AND member_id = company_member_id
  LOOP
    DELETE FROM member_login_identities
    WHERE organization_id = company_id AND member_id = company_member_id
      AND kind = identity_row.kind;
    INSERT INTO member_login_identities
      (organization_id, member_id, kind, normalized_value, verified_at)
    VALUES (center_id, center_member_id, identity_row.kind,
            identity_row.normalized_value, identity_row.verified_at);
  END LOOP;

  INSERT INTO member_profile_avatars
    (organization_id, member_id, image_data, version, updated_at)
  SELECT center_id, center_member_id, image_data, version, updated_at
  FROM member_profile_avatars
  WHERE organization_id = company_id AND member_id = company_member_id;

  INSERT INTO organization_access_grants
    (principal_organization_id, principal_member_id,
     target_organization_id, target_member_id)
  VALUES (center_id, center_member_id, company_id, company_member_id);

  -- Preserve open sessions in the company; switching back to the center now
  -- clears their active scope without forcing a new login.
  UPDATE auth_sessions
  SET organization_id = center_id, member_id = center_member_id,
      active_organization_id = company_id, active_member_id = company_member_id
  WHERE organization_id = company_id AND member_id = company_member_id;

  DELETE FROM member_credentials
  WHERE organization_id = company_id AND member_id = company_member_id;
END $$;
