ALTER TABLE order_services ADD COLUMN price_pending boolean NOT NULL DEFAULT false;

UPDATE order_services AS lines SET price_pending = true
FROM orders
WHERE orders.organization_id = lines.organization_id
  AND orders.id = lines.order_id
  AND orders.price_pending
  AND lines.unit_price_minor = 0;
