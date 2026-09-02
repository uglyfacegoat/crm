ALTER TABLE orders
  ADD COLUMN master_paid_total_minor bigint NOT NULL DEFAULT 0 CHECK (master_paid_total_minor >= 0);

CREATE TABLE order_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  order_id uuid NOT NULL,
  invoice_number text NOT NULL CHECK (length(btrim(invoice_number)) BETWEEN 1 AND 120),
  currency char(3) NOT NULL DEFAULT 'RUB' CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  issued_on date NOT NULL,
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  void_reason text CHECK (void_reason IS NULL OR length(btrim(void_reason)) BETWEEN 3 AND 1000),
  voided_at timestamptz,
  voided_by uuid,
  idempotency_key uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_on >= issued_on),
  CHECK ((status = 'void') = (voided_at IS NOT NULL)),
  CHECK ((status = 'void') = (voided_by IS NOT NULL)),
  CHECK ((status = 'void') = (void_reason IS NOT NULL)),
  FOREIGN KEY (organization_id, order_id) REFERENCES orders(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, voided_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, invoice_number),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, id, order_id)
);

CREATE INDEX order_invoices_due_idx
  ON order_invoices (organization_id, due_on, status);

CREATE INDEX order_invoices_order_idx
  ON order_invoices (organization_id, order_id, issued_on DESC);

CREATE TABLE order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  order_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  received_on date NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('bank_transfer', 'cash', 'card', 'other')),
  reference text CHECK (reference IS NULL OR length(reference) <= 200),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  reversal_reason text CHECK (reversal_reason IS NULL OR length(btrim(reversal_reason)) BETWEEN 3 AND 1000),
  reversed_at timestamptz,
  reversed_by uuid,
  idempotency_key uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'reversed') = (reversed_at IS NOT NULL)),
  CHECK ((status = 'reversed') = (reversed_by IS NOT NULL)),
  CHECK ((status = 'reversed') = (reversal_reason IS NOT NULL)),
  FOREIGN KEY (organization_id, invoice_id, order_id) REFERENCES order_invoices(organization_id, id, order_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reversed_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, id)
);

CREATE INDEX order_payments_order_idx
  ON order_payments (organization_id, order_id, received_on DESC);

CREATE INDEX order_payments_invoice_idx
  ON order_payments (organization_id, invoice_id, status);

CREATE TABLE order_master_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  order_id uuid NOT NULL,
  master_id uuid NOT NULL,
  master_name_snapshot text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  paid_on date NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('bank_transfer', 'cash', 'card', 'other')),
  reference text CHECK (reference IS NULL OR length(reference) <= 200),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  reversal_reason text CHECK (reversal_reason IS NULL OR length(btrim(reversal_reason)) BETWEEN 3 AND 1000),
  reversed_at timestamptz,
  reversed_by uuid,
  idempotency_key uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'reversed') = (reversed_at IS NOT NULL)),
  CHECK ((status = 'reversed') = (reversed_by IS NOT NULL)),
  CHECK ((status = 'reversed') = (reversal_reason IS NOT NULL)),
  FOREIGN KEY (organization_id, order_id) REFERENCES orders(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, master_id) REFERENCES masters(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reversed_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, id)
);

CREATE INDEX order_master_payouts_order_idx
  ON order_master_payouts (organization_id, order_id, paid_on DESC);

CREATE INDEX order_master_payouts_master_idx
  ON order_master_payouts (organization_id, master_id, paid_on DESC);

CREATE FUNCTION refresh_order_invoice_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_organization_id uuid := coalesce(NEW.organization_id, OLD.organization_id);
  affected_order_id uuid := coalesce(NEW.order_id, OLD.order_id);
BEGIN
  UPDATE orders
  SET invoiced_total_minor = coalesce((
        SELECT sum(amount_minor) FROM order_invoices
        WHERE organization_id = affected_organization_id AND order_id = affected_order_id AND status = 'issued'
      ), 0),
      updated_at = now()
  WHERE organization_id = affected_organization_id AND id = affected_order_id;
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE TRIGGER order_invoices_refresh_total_trigger
AFTER INSERT OR UPDATE OF amount_minor, status OR DELETE ON order_invoices
FOR EACH ROW EXECUTE FUNCTION refresh_order_invoice_total();

CREATE FUNCTION refresh_order_payment_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_organization_id uuid := coalesce(NEW.organization_id, OLD.organization_id);
  affected_order_id uuid := coalesce(NEW.order_id, OLD.order_id);
BEGIN
  UPDATE orders
  SET paid_total_minor = coalesce((
        SELECT sum(amount_minor) FROM order_payments
        WHERE organization_id = affected_organization_id AND order_id = affected_order_id AND status = 'posted'
      ), 0),
      updated_at = now()
  WHERE organization_id = affected_organization_id AND id = affected_order_id;
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE TRIGGER order_payments_refresh_total_trigger
AFTER INSERT OR UPDATE OF amount_minor, status OR DELETE ON order_payments
FOR EACH ROW EXECUTE FUNCTION refresh_order_payment_total();

CREATE FUNCTION refresh_order_master_paid_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_organization_id uuid := coalesce(NEW.organization_id, OLD.organization_id);
  affected_order_id uuid := coalesce(NEW.order_id, OLD.order_id);
BEGIN
  UPDATE orders
  SET master_paid_total_minor = coalesce((
        SELECT sum(amount_minor) FROM order_master_payouts
        WHERE organization_id = affected_organization_id AND order_id = affected_order_id AND status = 'posted'
      ), 0),
      updated_at = now()
  WHERE organization_id = affected_organization_id AND id = affected_order_id;
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE TRIGGER order_master_payouts_refresh_total_trigger
AFTER INSERT OR UPDATE OF amount_minor, status OR DELETE ON order_master_payouts
FOR EACH ROW EXECUTE FUNCTION refresh_order_master_paid_total();
