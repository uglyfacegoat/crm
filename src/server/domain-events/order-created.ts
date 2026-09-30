import type postgres from "postgres";

// Called by the order domain inside its create transaction. A committed order
// and its pending Workflow deliveries are therefore atomic. The order domain
// does not execute or interpret any Workflow graph.
export async function publishOrderCreated(transaction: postgres.TransactionSql,
  organizationId: string, orderId: string) {
  // Workflow is paused by default, including for any activation saved earlier.
  if (process.env.CRM_WORKFLOW_ENABLED !== "true") return;
  await transaction`WITH active AS MATERIALIZED (
      SELECT activation.organization_id, activation.map_id,
        activation.activation_id, activation.version
      FROM workflow_automation_activations activation
      JOIN workflow_maps map ON map.organization_id = activation.organization_id
        AND map.id = activation.map_id AND map.archived_at IS NULL
      WHERE activation.organization_id = ${organizationId} AND activation.enabled
      FOR SHARE OF activation
    )
    INSERT INTO workflow_automation_jobs
      (organization_id, map_id, activation_id, version, event_type, order_id)
    SELECT organization_id, map_id, activation_id, version, 'order_created', ${orderId}
    FROM active
    ON CONFLICT (organization_id, map_id, activation_id, order_id) DO NOTHING`;
}
