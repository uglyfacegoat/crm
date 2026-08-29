INSERT INTO organization_order_counters (organization_id, next_order_number)
SELECT organization_id,
  greatest(
    1001,
    coalesce(max(
      CASE
        WHEN order_number ~ '^№?[0-9]{1,18}$' THEN replace(order_number, '№', '')::bigint
        ELSE NULL
      END
    ), 1000) + 1
  )
FROM orders
GROUP BY organization_id
ON CONFLICT (organization_id) DO UPDATE
SET next_order_number = greatest(
    organization_order_counters.next_order_number,
    excluded.next_order_number
  ),
  updated_at = now();
