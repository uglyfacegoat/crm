export type LizaServiceRate = { name: string; pricePerSquareMeter: string };

export type LizaNoteFields = {
  object: string;
  area: string;
  serviceRates: LizaServiceRate[];
  total: string;
  maintenance: string;
};

export function isStructuredLizaNote(body: string) {
  return body.includes("Название объекта:") && body.includes("Площадь объекта:") &&
    body.includes("Общий чек:") && body.includes("Обслуживание:") &&
    (body.includes("Услуги и цены за м²:") || body.includes("Наименование услуг:"));
}

export function parseLizaNote(body: string): LizaNoteFields {
  const lines = body.split(/\r?\n/);
  const field = (label: string) => lines.find((line) => line.startsWith(`${label}:`))?.slice(label.length + 1).trim() ?? "";
  const serviceRows: LizaServiceRate[] = [];
  const tableStart = lines.findIndex((line) => line.trim() === "Услуги и цены за м²:");
  if (tableStart >= 0) {
    for (const line of lines.slice(tableStart + 1)) {
      if (/^(Общий чек|Обслуживание):/.test(line)) break;
      const row = line.match(/^•\s+(.+?)\s+—\s+(.+)$/);
      if (!row) continue;
      serviceRows.push({ name: row[1].trim(), pricePerSquareMeter: row[2].replace(/\s*₽\/м²$/, "").replace(/^цена уточняется$/, "").trim() });
    }
  } else {
    const names = field("Наименование услуг").split(/\s*;\s*/).filter(Boolean);
    const oldPrice = field("Цена за кВ.м.");
    serviceRows.push(...names.map((name, index) => ({ name, pricePerSquareMeter: names.length === 1 && index === 0 ? oldPrice : "" })));
  }
  return {
    object: field("Название объекта"),
    area: field("Площадь объекта"),
    serviceRates: serviceRows,
    total: field("Общий чек"),
    maintenance: field("Обслуживание"),
  };
}

export function formatLizaNote(fields: LizaNoteFields) {
  const rows = fields.serviceRates.filter((rate) => rate.name.trim()).map((rate) =>
    `• ${rate.name.trim()} — ${rate.pricePerSquareMeter.trim() ? `${rate.pricePerSquareMeter.trim()} ₽/м²` : "цена уточняется"}`);
  return [
    `Название объекта: ${fields.object.trim()}`,
    `Площадь объекта: ${fields.area.trim()}`,
    "Услуги и цены за м²:",
    ...(rows.length ? rows : ["—"]),
    `Общий чек: ${fields.total.trim()}`,
    `Обслуживание: ${fields.maintenance.trim()}`,
  ].join("\n");
}
