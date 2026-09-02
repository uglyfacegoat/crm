import { z } from "zod";
import { calculateServiceLineTotalMinor, parseMoneyToMinorUnits, parseQuantityToMilliunits } from "../orders/money.ts";
import type { ImportDatasetName, ImportIssue, ImportPackageRows, ImportRecordType, ImportValidationContext, ImportValidationResult } from "./types";

const maximumStoredIssues = 2_000;
const externalId = z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f]+$/);
const optionalEmail = z.union([z.literal(""), z.string().trim().email().max(254)]);
const optionalPhone = z.string().trim().max(40);
const optionalTaxId = z.union([z.literal(""), z.string().trim().regex(/^\d{10}(\d{2})?$/)]);
const money = z.string().trim().regex(/^\d{1,11}(?:[.,]\d{1,2})?$/);

const schemas = {
  clients: z.object({
    external_id: externalId,
    legal_name: z.string().trim().min(2).max(300),
    kind: z.enum(["legal_entity", "individual"]),
    tax_id: optionalTaxId,
    phone: optionalPhone,
    email: optionalEmail,
  }).superRefine((value, context) => {
    if (value.kind === "legal_entity" && !value.tax_id) context.addIssue({ code: "custom", path: ["tax_id"], message: "Для юридического лица требуется ИНН." });
  }),
  objects: z.object({
    external_id: externalId,
    client_external_id: externalId,
    name: z.string().trim().min(2).max(240),
    object_type: z.string().trim().min(2).max(100),
    address: z.string().trim().min(5).max(500),
  }),
  orders: z.object({
    external_id: externalId,
    order_number: z.string().trim().min(1).max(80),
    client_external_id: externalId,
    object_external_id: externalId,
    status: z.enum(["new", "approval", "scheduled", "in_progress", "completed", "overdue", "cancelled"]),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    agreed_total_rub: money,
    notes: z.string().trim().max(2_000),
  }),
  services: z.object({
    external_id: externalId,
    order_external_id: externalId,
    name: z.string().trim().min(2).max(240),
    quantity: z.string().trim().regex(/^\d{1,9}(?:[.,]\d{1,3})?$/),
    unit_price_rub: money,
  }),
  documents: z.object({
    external_id: externalId,
    order_external_id: externalId,
    title: z.string().trim().min(2).max(240),
    category: z.enum(["contract", "act", "visit_card", "invoice", "receipt", "photo", "other"]),
    filename: z.string().trim().min(1).max(255).refine((value) => !/[\\/]/.test(value), "Имя файла не должно содержать путь."),
  }),
} satisfies Record<ImportDatasetName, z.ZodType>;

const requiredHeaders: Record<ImportDatasetName, readonly string[]> = {
  clients: ["external_id", "legal_name", "kind", "tax_id", "phone", "email"],
  objects: ["external_id", "client_external_id", "name", "object_type", "address"],
  orders: ["external_id", "order_number", "client_external_id", "object_external_id", "status", "currency", "agreed_total_rub", "notes"],
  services: ["external_id", "order_external_id", "name", "quantity", "unit_price_rub"],
  documents: ["external_id", "order_external_id", "title", "category", "filename"],
};

const recordTypes: Record<ImportDatasetName, ImportRecordType> = {
  clients: "client", objects: "object", orders: "order", services: "service", documents: "document",
};

type ValidRows = { [Dataset in ImportDatasetName]: Array<z.output<(typeof schemas)[Dataset]> & { rowNumber: number }> };

function linkKey(type: ImportRecordType, id: string) {
  return `${type}:${id}`;
}

export function validateImportPackage(packageRows: ImportPackageRows, context: ImportValidationContext): ImportValidationResult {
  const counts = { clients: 0, objects: 0, orders: 0, services: 0, documents: 0 };
  const issues: ImportIssue[] = [];
  let errorCount = 0;
  let warningCount = 0;
  const validRows = { clients: [], objects: [], orders: [], services: [], documents: [] } as unknown as ValidRows;

  function addIssue(issue: ImportIssue) {
    if (issue.severity === "error") errorCount += 1;
    else warningCount += 1;
    if (issues.length < maximumStoredIssues) issues.push(issue);
  }

  for (const dataset of Object.keys(schemas) as ImportDatasetName[]) {
    const parsed = packageRows[dataset];
    if (!parsed) continue;
    counts[dataset] = parsed.rows.length;
    const allowed = new Set(requiredHeaders[dataset]);
    for (const header of requiredHeaders[dataset]) {
      if (!parsed.headers.includes(header)) addIssue({ dataset, rowNumber: 1, severity: "error", code: "missing_header", field: header, message: `Отсутствует обязательный столбец «${header}».` });
    }
    for (const header of parsed.headers) {
      if (!allowed.has(header)) addIssue({ dataset, rowNumber: 1, severity: "warning", code: "unknown_header", field: header, message: `Столбец «${header}» не входит в CRM CSV v1 и будет проигнорирован.` });
    }
    if (!parsed.rows.length) addIssue({ dataset, rowNumber: 1, severity: "warning", code: "empty_dataset", field: null, message: "Файл содержит заголовки, но не содержит записей." });
    const seen = new Set<string>();
    for (const row of parsed.rows) {
      const result = schemas[dataset].safeParse(row.values);
      if (!result.success) {
        for (const problem of result.error.issues) {
          const field = typeof problem.path[0] === "string" ? problem.path[0] : null;
          addIssue({ dataset, rowNumber: row.rowNumber, severity: "error", code: "invalid_value", field, message: field ? `Некорректное значение в поле «${field}».` : "Строка содержит некорректные данные." });
        }
        continue;
      }
      const id = result.data.external_id;
      if (seen.has(id)) {
        addIssue({ dataset, rowNumber: row.rowNumber, severity: "error", code: "duplicate_external_id", field: "external_id", message: "В файле повторяется внешний идентификатор." });
        continue;
      }
      seen.add(id);
      if (context.existingLinks.has(linkKey(recordTypes[dataset], id))) {
        addIssue({ dataset, rowNumber: row.rowNumber, severity: "warning", code: "already_imported", field: "external_id", message: "Запись с этим внешним идентификатором уже импортировалась и будет пропущена при применении." });
      }
      validRows[dataset].push({ ...result.data, rowNumber: row.rowNumber } as never);
    }
  }

  const clients = new Set(validRows.clients.map((row) => row.external_id));
  const objects = new Map(validRows.objects.map((row) => [row.external_id, row]));
  const orders = new Map(validRows.orders.map((row) => [row.external_id, row]));
  const objectIds = new Set(objects.keys());
  const orderIds = new Set(orders.keys());
  const exists = (type: ImportRecordType, ids: ReadonlySet<string>, id: string) => ids.has(id) || context.existingLinks.has(linkKey(type, id));

  for (const row of validRows.clients) {
    if (row.tax_id && context.existingClientTaxIds.has(row.tax_id)) addIssue({ dataset: "clients", rowNumber: row.rowNumber, severity: "warning", code: "existing_tax_id", field: "tax_id", message: "В CRM уже есть клиент с этим ИНН; перед применением потребуется подтверждение объединения." });
  }
  for (const row of validRows.objects) {
    if (!exists("client", clients, row.client_external_id)) addIssue({ dataset: "objects", rowNumber: row.rowNumber, severity: "error", code: "missing_client_reference", field: "client_external_id", message: "Клиент не найден ни в пакете, ни среди ранее импортированных записей." });
  }
  for (const row of validRows.orders) {
    const orderLinked = context.existingLinks.has(linkKey("order", row.external_id));
    if (!exists("client", clients, row.client_external_id)) addIssue({ dataset: "orders", rowNumber: row.rowNumber, severity: "error", code: "missing_client_reference", field: "client_external_id", message: "Клиент заказа не найден." });
    if (!exists("object", objectIds, row.object_external_id)) addIssue({ dataset: "orders", rowNumber: row.rowNumber, severity: "error", code: "missing_object_reference", field: "object_external_id", message: "Объект заказа не найден." });
    const object = objects.get(row.object_external_id);
    if (object && object.client_external_id !== row.client_external_id) addIssue({ dataset: "orders", rowNumber: row.rowNumber, severity: "error", code: "object_client_mismatch", field: "object_external_id", message: "Объект принадлежит другому клиенту в этом пакете." });
    if (!orderLinked && context.existingOrderNumbers.has(row.order_number)) addIssue({ dataset: "orders", rowNumber: row.rowNumber, severity: "error", code: "existing_order_number", field: "order_number", message: "Номер заказа уже существует в CRM." });
  }

  const serviceTotals = new Map<string, bigint>();
  const serviceCounts = new Map<string, number>();
  for (const row of validRows.services) {
    if (!exists("order", orderIds, row.order_external_id)) {
      addIssue({ dataset: "services", rowNumber: row.rowNumber, severity: "error", code: "missing_order_reference", field: "order_external_id", message: "Заказ услуги не найден." });
      continue;
    }
    try {
      const total = calculateServiceLineTotalMinor(parseMoneyToMinorUnits(row.unit_price_rub), parseQuantityToMilliunits(row.quantity));
      serviceTotals.set(row.order_external_id, (serviceTotals.get(row.order_external_id) ?? 0n) + total);
      serviceCounts.set(row.order_external_id, (serviceCounts.get(row.order_external_id) ?? 0) + 1);
    } catch {
      addIssue({ dataset: "services", rowNumber: row.rowNumber, severity: "error", code: "invalid_service_amount", field: "quantity", message: "Количество или цена услуги находятся вне допустимого диапазона." });
    }
  }
  for (const row of validRows.orders) {
    if (!serviceCounts.has(row.external_id) && !context.existingLinks.has(linkKey("order", row.external_id))) addIssue({ dataset: "orders", rowNumber: row.rowNumber, severity: "error", code: "order_without_services", field: null, message: "Для нового заказа требуется хотя бы одна услуга." });
    const serviceTotal = serviceTotals.get(row.external_id);
    if (serviceTotal !== undefined && serviceTotal !== parseMoneyToMinorUnits(row.agreed_total_rub)) addIssue({ dataset: "orders", rowNumber: row.rowNumber, severity: "warning", code: "order_total_mismatch", field: "agreed_total_rub", message: "Согласованная сумма отличается от суммы строк услуг." });
  }
  for (const row of validRows.documents) {
    if (!exists("order", orderIds, row.order_external_id)) addIssue({ dataset: "documents", rowNumber: row.rowNumber, severity: "error", code: "missing_order_reference", field: "order_external_id", message: "Заказ документа не найден." });
  }

  const totalRows = Object.values(counts).reduce((total, count) => total + count, 0);
  return { status: errorCount ? "blocked" : "ready", totalRows, errorCount, warningCount, counts, issues };
}
