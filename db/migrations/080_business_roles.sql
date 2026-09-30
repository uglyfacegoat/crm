ALTER TABLE organization_members DROP CONSTRAINT organization_members_role_check;
ALTER TABLE organization_members ADD CONSTRAINT organization_members_role_check
  CHECK (role IN (
    'admin', 'dispatcher', 'manager', 'accountant', 'master',
    'deputy', 'finance_controller', 'sales_lead', 'regional_director',
    'crm_coordinator', 'tender_specialist', 'foreman'
  ));

ALTER TABLE organization_members DROP CONSTRAINT organization_members_master_role;
ALTER TABLE organization_members ADD CONSTRAINT organization_members_master_role
  CHECK (master_id IS NULL OR role IN ('master', 'foreman'));
ALTER TABLE organization_members DROP CONSTRAINT organization_members_master_required;
ALTER TABLE organization_members ADD CONSTRAINT organization_members_master_required
  CHECK (role NOT IN ('master', 'foreman') OR master_id IS NOT NULL);
