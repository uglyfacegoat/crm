import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentArchiveTree, parseDocumentArchiveSelection } from "./archive.ts";

const clientId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";

test("archive selection accepts a complete hierarchy", () => {
  assert.deepEqual(parseDocumentArchiveSelection({ client: clientId, object: objectId, order: orderId, category: "act" }), {
    clientId,
    objectId,
    orderId,
    category: "act",
    folderId: null,
    favoriteOnly: false,
  });
});

test("archive selection rejects orphaned and malformed levels", () => {
  assert.deepEqual(parseDocumentArchiveSelection({ order: orderId }), { clientId: null, objectId: null, orderId: null, category: null, folderId: null, favoriteOnly: false });
  assert.deepEqual(parseDocumentArchiveSelection({ client: "not-a-uuid" }), { clientId: null, objectId: null, orderId: null, category: null, folderId: null, favoriteOnly: false });
});

test("archive tree aggregates counts without duplicating hierarchy nodes", () => {
  const tree = buildDocumentArchiveTree([
    { clientId, clientName: "Клиент", objectId, objectName: "Склад", objectAddress: "Москва", orderId, orderNumber: "100", category: "act", documentCount: 2 },
    { clientId, clientName: "Клиент", objectId, objectName: "Склад", objectAddress: "Москва", orderId, orderNumber: "100", category: "photo", documentCount: 3 },
  ]);

  assert.deepEqual({ documents: tree.documentCount, clients: tree.clientCount, objects: tree.objectCount, orders: tree.orderCount }, { documents: 5, clients: 1, objects: 1, orders: 1 });
  assert.equal(tree.clients[0]?.objects[0]?.orders[0]?.categories.length, 2);
  assert.equal(tree.clients[0]?.documentCount, 5);
});
