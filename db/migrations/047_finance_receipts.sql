ALTER TABLE order_payments
  ADD COLUMN receipt_document_id uuid,
  ADD CONSTRAINT order_payments_receipt_document_fk
    FOREIGN KEY (organization_id, receipt_document_id)
    REFERENCES documents(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT order_payments_receipt_document_unique
    UNIQUE (organization_id, receipt_document_id);

ALTER TABLE order_master_payouts
  ADD COLUMN receipt_document_id uuid,
  ADD CONSTRAINT order_master_payouts_receipt_document_fk
    FOREIGN KEY (organization_id, receipt_document_id)
    REFERENCES documents(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT order_master_payouts_receipt_document_unique
    UNIQUE (organization_id, receipt_document_id);
