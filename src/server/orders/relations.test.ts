import assert from "node:assert/strict";
import test from "node:test";
import { linkOrderSchema } from "./relation-schemas.ts";

const firstOrderId = "11111111-1111-4111-8111-111111111111";
const secondOrderId = "22222222-2222-4222-8222-222222222222";

test("linkOrderSchema accepts two distinct order identifiers", () => {
  assert.equal(linkOrderSchema.safeParse({ orderId: firstOrderId, relatedOrderId: secondOrderId }).success, true);
});

test("linkOrderSchema rejects linking an order to itself", () => {
  const result = linkOrderSchema.safeParse({ orderId: firstOrderId, relatedOrderId: firstOrderId });
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.flatten().fieldErrors.relatedOrderId?.[0], "Заказ нельзя связать с самим собой");
});
