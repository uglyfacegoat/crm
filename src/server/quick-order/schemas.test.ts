import assert from "node:assert/strict";
import test from "node:test";
import { quickOrderSchema } from "./schemas.ts";

const baseOrder = {
  assignedMasterId: "",
  masterPayment: "",
  notes: "Первичная обработка",
  services: [{ name: "Дератизация", quantity: "1", unitPrice: "25000", note: "" }],
  expenses: [],
};

const baseVisit = {
  localDate: "2026-09-01",
  localTime: "10:30",
  durationMinutes: 120,
  assignedMasterId: "",
  notes: "Позвонить за час",
};

test("validates an atomic quick order for a new client", () => {
  const parsed = quickOrderSchema.parse({
    idempotencyKey: "72b4534b-37dc-4a8b-8b8c-7d4ce832b228",
    client: {
      mode: "new",
      details: {
        kind: "legal_entity",
        legalName: "ООО Тест",
        taxId: "7712345678",
        contactName: "Иван Иванов",
        contactPosition: "Директор",
        phone: "+7 999 123-45-67",
        email: "test@example.com",
      },
      object: {
        name: "Склад",
        objectType: "Склад",
        address: "Москва, улица Тестовая, 1",
        areaSquareMeters: "500",
        floorCount: "1",
        onsiteContact: "",
        accessInstructions: "",
        parkingNotes: "",
        restrictions: "",
        riskLevel: 3,
        infestationLevel: 1,
      },
    },
    order: baseOrder,
    visit: baseVisit,
  });

  assert.equal(parsed.client.mode, "new");
  assert.equal(parsed.order.assignedMasterId, null);
  assert.equal(parsed.visit.assignedMasterId, null);
});

test("supports existing client references", () => {
  const parsed = quickOrderSchema.safeParse({
    idempotencyKey: "72b4534b-37dc-4a8b-8b8c-7d4ce832b228",
    client: {
      mode: "existing",
      clientId: "22d76b50-1c4a-4202-b924-785ae0595858",
      contact: { mode: "existing", contactId: "3833d00f-e9fb-458a-b108-88b4dc433cf0" },
      object: { mode: "existing", objectId: "57b6e68d-9316-43bd-8ada-c44b34eb21b7" },
    },
    order: baseOrder,
    visit: baseVisit,
  });

  assert.equal(parsed.success, true);
});

test("rejects different masters in order and visit", () => {
  const firstMaster = "4ec34ef3-5164-4aa3-8622-aa2ab68e1d77";
  const parsed = quickOrderSchema.safeParse({
    idempotencyKey: "72b4534b-37dc-4a8b-8b8c-7d4ce832b228",
    client: {
      mode: "existing",
      clientId: "22d76b50-1c4a-4202-b924-785ae0595858",
      contact: { mode: "existing", contactId: "3833d00f-e9fb-458a-b108-88b4dc433cf0" },
      object: { mode: "existing", objectId: "57b6e68d-9316-43bd-8ada-c44b34eb21b7" },
    },
    order: { ...baseOrder, assignedMasterId: firstMaster, masterPayment: "4000" },
    visit: { ...baseVisit, assignedMasterId: "9e64d180-9240-48d3-ab3e-b891059af2f6" },
  });

  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues[0]?.message ?? "", /должен совпадать/i);
});
