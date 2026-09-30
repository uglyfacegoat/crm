import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const dryRun = process.argv.includes("--dry-run");
const apply = process.argv.includes("--apply");
if (dryRun === apply || process.env.CRM_REVIEW_FIXTURES !== "CONFIRM_REVIEW_FIXTURES_2026") {
  throw new Error("Pass --dry-run or --apply with CRM_REVIEW_FIXTURES=CONFIRM_REVIEW_FIXTURES_2026.");
}
if (!process.env.DATABASE_URL || process.env.DOCUMENT_STORAGE_BACKEND !== "local" || !process.env.DOCUMENT_STORAGE_ROOT) {
  throw new Error("Expected the configured local-storage CRM runtime.");
}

const organizationId = "fb21160f-7de6-43fe-8ad8-3060a1e774ff";
const actorId = "43b376db-757a-4b7e-8651-77cbf8363abf";
const ownerId = "cf71ec1f-306b-46a5-ba9e-c4eeb3a63c88";
const label = "ТЕСТОВЫЕ ДАННЫЕ";
const ids = {};
function id(key) {
  if (ids[key]) return ids[key];
  const hex = createHash("sha256").update(`crm-review-fixtures-v1:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return (ids[key] = `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`);
}

function pdfDocument() {
  const lines = ["TEST DATA - CRM review document", "Example warehouse service act", "Not a real contract or payment"];
  const stream = `BT\n/F1 16 Tf\n72 760 Td\n${lines.map((line, index) => `${index ? "0 -28 Td\n" : ""}(${line}) Tj`).join("\n")}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}

const pdf = pdfDocument();
const pdfHash = createHash("sha256").update(pdf).digest("hex");
const storageKey = `${organizationId}/${id("document")}/v1.pdf`;
const storagePath = join(process.env.DOCUMENT_STORAGE_ROOT, storageKey);
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => undefined });
let createdFile = false;
const inserted = {};
async function add(tx, key, query) {
  const rows = await query;
  inserted[key] = rows.length;
}

try {
  if (apply) {
    await mkdir(join(process.env.DOCUMENT_STORAGE_ROOT, organizationId, id("document")), { recursive: true });
    try {
      await writeFile(storagePath, pdf, { flag: "wx", mode: 0o600 });
      createdFile = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readFile(storagePath);
      if (createHash("sha256").update(existing).digest("hex") !== pdfHash) throw new Error("Demo PDF path already has other content.");
    }
  }

  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('crm-review-fixtures-v1', 0))`;
    const [organization] = await tx`SELECT id FROM organizations WHERE id = ${organizationId} AND organization_kind = 'center'`;
    const [actor] = await tx`SELECT id FROM organization_members WHERE organization_id = ${organizationId} AND id = ${actorId} AND display_name = 'Технический проверяющий' AND active`;
    const [owner] = await tx`SELECT id FROM organization_members WHERE organization_id = ${organizationId} AND id = ${ownerId} AND display_name = 'Ярослав' AND active`;
    if (!organization || !actor || !owner) throw new Error("Expected center and review accounts are missing.");

    await add(tx, "clients", tx`INSERT INTO clients (id, organization_id, legal_name, kind, primary_phone, primary_email)
      VALUES (${id("client")}, ${organizationId}, ${`${label} — ООО «Пример-заказчик»`}, 'legal_entity', '+70000000001', 'client@example.test')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "contacts", tx`INSERT INTO client_contacts (id, organization_id, client_id, full_name, position, phone, normalized_phone, email, is_primary)
      VALUES (${id("contact")}, ${organizationId}, ${id("client")}, ${`${label} — Контакт заказчика`}, 'Контакт для демонстрации', '+70000000002', '+70000000002', 'contact@example.test', true)
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "objects", tx`INSERT INTO client_objects (id, organization_id, client_id, name, object_type, address, area_square_meters, floor_count, onsite_contact, access_instructions)
      VALUES (${id("object")}, ${organizationId}, ${id("client")}, ${`${label} — Склад`}, 'Склад', ${`${label}, г. Москва, Примерная улица, 1`}, 1250, 1, ${`${label} — Контакт заказчика`}, 'Демонстрационный объект, реальный выезд не требуется.')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "zones", tx`INSERT INTO object_zones (id, organization_id, object_id, name, risk_notes)
      VALUES (${id("zone")}, ${organizationId}, ${id("object")}, ${`${label} — Зона хранения`}, 'Пример зоны склада, не реальный адрес.')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "masters", tx`INSERT INTO masters (id, organization_id, full_name, phone, normalized_phone, service_region, service_zone, notes, skills)
      VALUES (${id("master")}, ${organizationId}, ${`${label} — Мастер`}, '+70000000003', '+70000000003', 'Тестовый регион', 'Тестовая зона', 'Демонстрационная запись. Реальному сотруднику не назначать.', ARRAY['Тестовая обработка']::text[])
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "orders", tx`INSERT INTO orders (id, organization_id, client_id, object_id, client_contact_id, order_number, status, currency, agreed_total_minor,
        assigned_master_id, client_name_snapshot, object_name_snapshot, object_address_snapshot, contact_name_snapshot, contact_phone_snapshot,
        master_name_snapshot, master_phone_snapshot, master_payment_snapshot_minor, notes, created_by)
      VALUES (${id("order")}, ${organizationId}, ${id("client")}, ${id("object")}, ${id("contact")}, 'ТЕСТ-001', 'in_progress', 'RUB', 1200000,
        ${id("master")}, ${`${label} — ООО «Пример-заказчик»`}, ${`${label} — Склад`}, ${`${label}, г. Москва, Примерная улица, 1`},
        ${`${label} — Контакт заказчика`}, '+70000000002', ${`${label} — Мастер`}, '+70000000003', 150000,
        'ТЕСТОВЫЕ ДАННЫЕ — демонстрационный заказ. Не выполнять и не выставлять реальные счета.', ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "services", tx`INSERT INTO order_services (id, organization_id, order_id, service_name_snapshot, quantity, unit_price_minor, line_total_minor, position, note)
      VALUES (${id("service")}, ${organizationId}, ${id("order")}, ${`${label} — Обработка склада`}, 1, 1200000, 1200000, 1, 'Пример услуги, не выполнять.')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "contracts", tx`INSERT INTO contracts (id, organization_id, client_id, object_id, contract_number, status, starts_on, ends_on, renewal_notice_days, notes, created_by, updated_by)
      VALUES (${id("contract")}, ${organizationId}, ${id("client")}, ${id("object")}, 'ТЕСТ-ДОГОВОР-001', 'draft', current_date, current_date + 180, 30,
        'ТЕСТОВЫЕ ДАННЫЕ — пример договора без юридической силы.', ${actorId}, ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "contractEvents", tx`INSERT INTO contract_events (id, organization_id, contract_id, actor_id, event_type, after_state, reason)
      VALUES (${id("contract-event")}, ${organizationId}, ${id("contract")}, ${actorId}, 'created',
        ${tx.json({ contractNumber: "ТЕСТ-ДОГОВОР-001", status: "draft", seed: "review-fixtures-v1" })}, 'ТЕСТОВЫЕ ДАННЫЕ — пример истории договора.')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "visits", tx`INSERT INTO service_visits (id, organization_id, order_id, contract_id, object_id, assigned_master_id, scheduled_start_at, scheduled_end_at, status,
        client_name_snapshot, object_name_snapshot, object_address_snapshot, master_name_snapshot, master_phone_snapshot, notes, created_by, updated_by)
      VALUES (${id("visit")}, ${organizationId}, ${id("order")}, ${id("contract")}, ${id("object")}, ${id("master")},
        now() - interval '3 hours', now() - interval '1 hour', 'confirmed', ${`${label} — ООО «Пример-заказчик»`},
        ${`${label} — Склад`}, ${`${label}, г. Москва, Примерная улица, 1`}, ${`${label} — Мастер`}, '+70000000003',
        'ТЕСТОВЫЕ ДАННЫЕ — демонстрационный выезд. Не отправлять мастера.', ${actorId}, ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "visitEvents", tx`INSERT INTO service_visit_events (id, organization_id, visit_id, actor_id, event_type, after_state, reason)
      VALUES (${id("visit-event")}, ${organizationId}, ${id("visit")}, ${actorId}, 'created', ${tx.json({ status: "confirmed", seed: "review-fixtures-v1" })}, 'ТЕСТОВЫЕ ДАННЫЕ — пример выезда.')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "tasks", tx`INSERT INTO tasks (id, organization_id, title, description, status, priority, due_at, assigned_member_id, related_order_id, related_visit_id, created_by, updated_by)
      VALUES (${id("task")}, ${organizationId}, ${`${label} — Проверить заказ`}, 'Демонстрационная задача для обзора экрана. Не требует исполнения.',
        'open', 'normal', NULL, ${actorId}, ${id("order")}, ${id("visit")}, ${actorId}, ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "taskEvents", tx`INSERT INTO task_events (id, organization_id, task_id, actor_id, event_type, after_state, reason)
      VALUES (${id("task-event")}, ${organizationId}, ${id("task")}, ${actorId}, 'created', ${tx.json({ title: `${label} — Проверить заказ`, status: "open", seed: "review-fixtures-v1" })}, 'ТЕСТОВЫЕ ДАННЫЕ — пример задачи.')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "invoices", tx`INSERT INTO order_invoices (id, organization_id, order_id, invoice_number, amount_minor, issued_on, due_on, note, idempotency_key, created_by)
      VALUES (${id("invoice")}, ${organizationId}, ${id("order")}, 'ТЕСТ-СЧЁТ-001', 1200000, current_date, current_date + 30,
        'ТЕСТОВЫЕ ДАННЫЕ — пример счёта, не оплачивать реально.', ${id("invoice-idempotency")}, ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "payments", tx`INSERT INTO order_payments (id, organization_id, order_id, invoice_id, amount_minor, received_on, payment_method, reference, note, idempotency_key, created_by)
      VALUES (${id("payment")}, ${organizationId}, ${id("order")}, ${id("invoice")}, 1200000, current_date, 'bank_transfer', 'ТЕСТ-ОПЛАТА-001',
        'ТЕСТОВЫЕ ДАННЫЕ — запись оплаты, не банковская операция.', ${id("payment-idempotency")}, ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "expenses", tx`INSERT INTO order_expenses (id, organization_id, order_id, category, amount_minor, occurred_on, note, created_by)
      VALUES (${id("expense")}, ${organizationId}, ${id("order")}, ${`${label} — Материалы`}, 200000, current_date, 'Демонстрационный расход.', ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "payouts", tx`INSERT INTO order_master_payouts (id, organization_id, order_id, master_id, master_name_snapshot, amount_minor, paid_on, payment_method, reference, note, idempotency_key, created_by)
      VALUES (${id("payout")}, ${organizationId}, ${id("order")}, ${id("master")}, ${`${label} — Мастер`}, 150000, current_date, 'bank_transfer', 'ТЕСТ-ВЫПЛАТА-001',
        'ТЕСТОВЫЕ ДАННЫЕ — запись выплаты, не банковская операция.', ${id("payout-idempotency")}, ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "folders", tx`INSERT INTO document_folders (id, organization_id, name, created_by)
      VALUES (${id("folder")}, ${organizationId}, ${`${label} — Документы`}, ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "documents", tx`INSERT INTO documents (id, organization_id, client_id, object_id, order_id, visit_id, contract_id, folder_id, title, category, description, created_by)
      VALUES (${id("document")}, ${organizationId}, ${id("client")}, ${id("object")}, ${id("order")}, ${id("visit")}, ${id("contract")}, ${id("folder")},
        ${`${label} — Пример акта (PDF)`}, 'act', 'Демонстрационный PDF, не действующий акт.', ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "documentVersions", tx`INSERT INTO document_versions (id, organization_id, document_id, version_number, original_filename, storage_key, mime_type, extension, size_bytes, sha256, uploaded_by)
      VALUES (${id("document-version")}, ${organizationId}, ${id("document")}, 1, 'TEST_DATA_contract.pdf', ${storageKey}, 'application/pdf', 'pdf', ${pdf.length}, ${pdfHash}, ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await tx`UPDATE documents SET current_version_id = ${id("document-version")}
      WHERE organization_id = ${organizationId} AND id = ${id("document")} AND current_version_id IS NULL`;
    await tx`UPDATE service_visits SET status = 'completed', completion_document_id = ${id("document")},
        completion_notes = 'ТЕСТОВЫЕ ДАННЫЕ — демонстрационное завершение, реального выезда не было.',
        completed_at = now(), completed_by = ${actorId}, updated_by = ${actorId}
      WHERE organization_id = ${organizationId} AND id = ${id("visit")} AND status = 'confirmed'`;
    await add(tx, "visitCompletedEvents", tx`INSERT INTO service_visit_events (id, organization_id, visit_id, actor_id, event_type, after_state, reason)
      VALUES (${id("visit-completed-event")}, ${organizationId}, ${id("visit")}, ${actorId}, 'status_changed',
        ${tx.json({ status: "completed", seed: "review-fixtures-v1" })}, 'ТЕСТОВЫЕ ДАННЫЕ — демонстрационное завершение.')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "favorites", tx`INSERT INTO document_favorites (organization_id, document_id, member_id)
      VALUES (${organizationId}, ${id("document")}, ${ownerId}) ON CONFLICT DO NOTHING RETURNING document_id`);
    await add(tx, "websites", tx`INSERT INTO websites (id, organization_id, name, domain, status)
      VALUES (${id("website")}, ${organizationId}, ${`${label} — Пример сайта`}, 'review-demo.example.test', 'disabled')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "leads", tx`INSERT INTO website_leads (id, organization_id, website_id, external_event_id, received_at, contact_name, phone, email,
        service_interest, landing_url, payload_fingerprint, object_address, comment)
      VALUES (${id("lead")}, ${organizationId}, ${id("website")}, 'review-demo-v1', now(), ${`${label} — Обращение`}, '+70000000004', 'lead@example.test',
        ${`${label} — Обработка склада`}, 'https://review-demo.example.test/', ${createHash("sha256").update("review-demo-v1").digest("hex")},
        ${`${label}, г. Москва, Примерная улица, 1`}, 'ТЕСТОВЫЕ ДАННЫЕ — не обрабатывать как реальную заявку.')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await tx`DELETE FROM mail_delivery_jobs WHERE organization_id = ${organizationId} AND source_type = 'lead' AND source_id = ${id("lead")}`;
    const rawMail = `From: Demo <sender@example.test>\r\nTo: demo@example.test\r\nSubject: TEST DATA - CRM review\r\n\r\nTEST DATA - no real message.`;
    await add(tx, "mail", tx`INSERT INTO mail_messages (id, organization_id, mailbox_address, uid_validity, imap_uid, from_address, from_name, to_addresses,
        subject, body_text, raw_message, received_at, recipient_address)
      VALUES (${id("mail")}, ${organizationId}, 'demo@example.test', 1, 1, 'sender@example.test', ${`${label} — Отправитель`}, ARRAY['demo@example.test']::text[],
        ${`${label} — пример письма`}, 'Демонстрационное письмо. Ничего не отправлено и отвечать не нужно.',
        decode(${Buffer.from(rawMail).toString("hex")}, 'hex'), now(), 'demo@example.test')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await tx`DELETE FROM mail_delivery_jobs WHERE organization_id = ${organizationId} AND source_type = 'mail' AND source_id = ${id("mail")}`;
    await add(tx, "channels", tx`INSERT INTO chat_channels (id, organization_id, name, description, kind, created_by)
      VALUES (${id("channel")}, ${organizationId}, ${`${label} — Чат для обзора`}, 'Демонстрационный канал, без рабочих сообщений.', 'group', ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    for (const [memberId, role] of [[actorId, "owner"], [ownerId, "member"]]) {
      await add(tx, `chatMember:${role}`, tx`INSERT INTO chat_channel_members (organization_id, channel_id, member_id, channel_role, joined_by)
        VALUES (${organizationId}, ${id("channel")}, ${memberId}, ${role}, ${actorId})
        ON CONFLICT DO NOTHING RETURNING member_id`);
    }
    await add(tx, "chatMessages", tx`INSERT INTO chat_messages (id, organization_id, channel_id, author_id, body)
      VALUES (${id("chat-message")}, ${organizationId}, ${id("channel")}, ${actorId}, 'ТЕСТОВЫЕ ДАННЫЕ — пример сообщения для проверки чата. Реальных коллег здесь нет.')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    const nodeA = id("workflow-node-a"), nodeB = id("workflow-node-b");
    const draft = { nodes: [
      { id: nodeA, kind: "event", title: `${label} — заявка`, description: "Пример начала процесса.", x: 80, y: 100 },
      { id: nodeB, kind: "note", title: `${label} — проверка`, description: "Автоматизация выключена.", x: 420, y: 100 },
    ], edges: [{ id: id("workflow-edge"), sourceId: nodeA, targetId: nodeB, label: "пример" }] };
    await add(tx, "workflowMaps", tx`INSERT INTO workflow_maps (id, organization_id, title, description, draft, created_by, updated_by)
      VALUES (${id("workflow-map")}, ${organizationId}, ${`${label} — Пример процесса`}, 'Демонстрационная карта. Автоматизация не включена.', ${tx.json(draft)}, ${actorId}, ${actorId})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "workflowRevisions", tx`INSERT INTO workflow_map_revisions (organization_id, map_id, version, title, description, draft, change_kind, saved_by)
      VALUES (${organizationId}, ${id("workflow-map")}, 1, ${`${label} — Пример процесса`}, 'Демонстрационная карта. Автоматизация не включена.',
        ${tx.json(draft)}, 'created', ${actorId}) ON CONFLICT DO NOTHING RETURNING map_id`);
    await add(tx, "notifications", tx`INSERT INTO notifications (id, organization_id, recipient_member_id, kind, severity, title, body,
        source_type, source_id, target_type, target_id, event_key, occurred_at, read_at)
      VALUES (${id("notification")}, ${organizationId}, ${ownerId}, 'document_uploaded', 'info', ${`${label} — документ добавлен`},
        'Демонстрационное уведомление. Это не рабочее событие.', 'document', ${id("document")}, 'document', ${id("document")},
        'review-fixtures-v1:document', now(), now()) ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "supportRequests", tx`INSERT INTO support_requests (id, organization_id, requested_by, category, subject, description, status)
      VALUES (${id("support-request")}, ${organizationId}, ${actorId}, 'usability', ${`${label} — Пример обращения`},
        'Демонстрационное обращение для просмотра очереди. Отвечать и обрабатывать не требуется.', 'new')
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    await add(tx, "audit", tx`INSERT INTO audit_events (id, organization_id, actor_id, action, entity_type, entity_id, changes)
      VALUES (${id("audit")}, ${organizationId}, ${actorId}, 'review.fixtures.seed', 'client', ${id("client")}, ${tx.json({ seed: "review-fixtures-v1", label })})
      ON CONFLICT (id) DO NOTHING RETURNING id`);

    if (dryRun) throw new Error("DRY_RUN_ROLLBACK");
  });
  console.log(JSON.stringify({ status: "applied", inserted, ids, storageKey }));
} catch (error) {
  if (createdFile) await unlink(storagePath);
  if (dryRun && error?.message === "DRY_RUN_ROLLBACK") {
    console.log(JSON.stringify({ status: "dry-run-ok", wouldInsert: inserted, ids, storageKey }));
  } else {
    throw error;
  }
} finally {
  await sql.end();
}
