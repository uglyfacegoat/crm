import "server-only";
import { createHash } from "node:crypto";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { createDocument } from "@/server/documents/repository";
import { validateDocumentFile } from "@/server/documents/file-validation";
import { createDocumentStorageKey, readVerifiedDocumentFile, writeDocumentFile } from "@/server/documents/storage";
import { markFileWriteUncertain, withFileWriteLease } from "../file-writes/gate.mjs";
import type { DocumentTemplateField, DocumentGenerationKind } from "@/lib/document-template-fields";
import { DocumentTemplateGenerationError, renderTemplateDocument } from "./renderer";
import type { GenerateOrderDocumentInput } from "./generation-schemas";

function formatDate(date: string) { return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
export async function generateOrderDocument(member: AuthenticatedMember, input: GenerateOrderDocumentInput) {
  requirePermission(member, "orders.read"); requirePermission(member, "documents.read"); requirePermission(member, "documents.write");
  const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const sql = getDatabase();
  return withFileWriteLease(async () => {
    let attemptedFile = false;
    try {
      return await sql.begin(async tx => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${member.organizationId}:document.generate:${input.idempotencyKey}`}, 0))`;
        const [existing] = await tx`SELECT id, order_id, created_by, generation_input_hash FROM documents
          WHERE organization_id = ${member.organizationId} AND id = ${input.idempotencyKey}`;
        if (existing) {
          if (existing.order_id !== input.orderId || existing.created_by !== member.memberId || existing.generation_input_hash !== inputHash) throw new DocumentTemplateGenerationError("Этот запрос уже использован для другого документа. Обновите форму.");
          return { documentId: String(existing.id), alreadyCreated: true };
        }
        const [order] = await tx`SELECT orders.id, orders.version, orders.order_number, orders.client_name_snapshot,
          orders.object_name_snapshot, orders.object_address_snapshot, orders.master_name_snapshot,
          orders.contact_name_snapshot, orders.agreed_total_minor, orders.price_pending, objects.area_square_meters::text,
          organizations.name AS organization_name, organizations.timezone
          FROM orders JOIN organizations ON organizations.id = orders.organization_id
          LEFT JOIN client_objects objects ON objects.organization_id = orders.organization_id AND objects.id = orders.object_id
          WHERE orders.organization_id = ${member.organizationId} AND orders.id = ${input.orderId} FOR SHARE OF orders`;
        if (!order) throw new DocumentTemplateGenerationError("Заказ недоступен.");
        if (order.version !== input.expectedOrderVersion) throw new DocumentTemplateGenerationError("Заказ изменился. Обновите карточку перед генерацией.");
        const [template] = await tx`SELECT templates.title, templates.version, versions.id, versions.extension, versions.storage_key,
          versions.size_bytes, versions.sha256, versions.generation_kind, versions.generation_fields, versions.generation_defaults
          FROM document_templates templates JOIN document_template_versions versions
            ON versions.organization_id = templates.organization_id AND versions.id = templates.current_version_id
          WHERE templates.organization_id = ${member.organizationId} AND templates.id = ${input.templateId} AND templates.active
          FOR SHARE OF templates`;
        if (!template) throw new DocumentTemplateGenerationError("Шаблон снят с публикации или недоступен.");
        if (template.version !== input.expectedTemplateVersion) throw new DocumentTemplateGenerationError("Шаблон изменился. Обновите список перед генерацией.");
        if (template.generation_fields.includes("order_total")) requirePermission(member, "finance.read");
        if (!template.generation_kind) throw new DocumentTemplateGenerationError("В этом бланке нет полей для автозаполнения. Выберите шаблон для генерации.");
        let workDate = input.documentDate;
        if (input.visitId) {
          requirePermission(member, "visits.read");
          const [visit] = await tx`SELECT (scheduled_start_at AT TIME ZONE ${order.timezone})::date::text AS work_date
            FROM service_visits WHERE organization_id = ${member.organizationId} AND order_id = ${input.orderId} AND id = ${input.visitId} FOR SHARE`;
          if (!visit) throw new DocumentTemplateGenerationError("Выезд не относится к этому заказу.");
          workDate = visit.work_date as string;
        }
        if (template.generation_fields.includes("object_address") && !String(order.object_address_snapshot ?? "").trim()) throw new DocumentTemplateGenerationError("Для акта заполните адрес объекта в заказе.");
        const values: Record<DocumentTemplateField, string> = {
          order_number: String(order.order_number), client_name: String(order.client_name_snapshot),
          object_name: String(order.object_name_snapshot), object_address: String(order.object_address_snapshot),
          document_date: formatDate(input.documentDate), work_date: formatDate(workDate),
          executor_name: input.executorName, executor_name_repeat: input.executorName, executor_name_signature: input.executorName,
          services: input.services, preparations: input.preparations, recommendations: input.recommendations,
          area_deratization: input.areaDeratization.replace(".", ","), area_disinsection: input.areaDisinsection.replace(".", ","),
          area_disinfection: input.areaDisinfection.replace(".", ","), object_area: String(order.area_square_meters ?? "").replace(".", ","),
          company_name: String(order.organization_name), contact_name: String(order.contact_name_snapshot ?? ""),
          order_total: order.price_pending ? "Цена уточняется" : new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(Number(order.agreed_total_minor) / 100),
        };
        const source = await readVerifiedDocumentFile(String(template.storage_key), { sizeBytes: Number(template.size_bytes), sha256: String(template.sha256) }, 15 * 1024 * 1024);
        const buffer = await renderTemplateDocument(source, template.generation_kind as DocumentGenerationKind, values, input.documentDate);
        const filename = `Акт-${String(order.order_number).replace(/[^\p{L}\p{N}_-]/gu, "-").slice(0, 120)}-${input.documentDate}.${template.extension}`;
        const file = validateDocumentFile({ filename, declaredMimeType: template.extension === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer });
        const storageKey = createDocumentStorageKey(member.organizationId, input.idempotencyKey, file.extension);
        attemptedFile = true;
        try { await writeDocumentFile(storageKey, buffer); }
        catch (error) {
          if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
          await readVerifiedDocumentFile(storageKey, { sizeBytes: file.sizeBytes, sha256: file.sha256 }, 15 * 1024 * 1024);
        }
        const documentId = await createDocument(member, { idempotencyKey: input.idempotencyKey, orderId: input.orderId, visitId: input.visitId,
          contractId: null, category: "act", title: `${template.title} · ${order.order_number}`.slice(0, 240),
          description: `Сформирован по шаблону «${template.title}». Дата документа: ${formatDate(input.documentDate)}.`,
          ...file, storageKey, generatedTemplateVersionId: String(template.id), generationInputHash: inputHash }, tx);
        return { documentId, alreadyCreated: false };
      });
    } catch (error) { if (attemptedFile) markFileWriteUncertain(); throw error; }
  });
}
