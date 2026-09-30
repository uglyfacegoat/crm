ALTER TABLE organization_members DROP CONSTRAINT organization_members_role_check;
ALTER TABLE organization_members ADD CONSTRAINT organization_members_role_check
  CHECK (role IN (
    'admin', 'dispatcher', 'manager', 'accountant', 'master',
    'deputy', 'finance_controller', 'sales_lead', 'regional_director',
    'crm_coordinator', 'sales_specialist', 'tender_specialist', 'foreman'
  ));
