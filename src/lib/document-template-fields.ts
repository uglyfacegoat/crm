export const documentTemplateFields = {
  order_number: "Номер заказа", client_name: "Заказчик", object_name: "Объект", object_address: "Адрес объекта",
  document_date: "Дата документа", work_date: "Дата работ", executor_name: "Исполнитель",
  executor_name_repeat: "Исполнитель", executor_name_signature: "Исполнитель",
  services: "Выполненные работы", area_deratization: "Площадь дератизации", area_disinsection: "Площадь дезинсекции",
  area_disinfection: "Площадь дезинфекции", object_area: "Площадь объекта", preparations: "Препараты",
  recommendations: "Рекомендации", company_name: "Исполнитель: компания", contact_name: "Представитель заказчика", order_total: "Сумма заказа",
} as const;
export type DocumentTemplateField = keyof typeof documentTemplateFields;
export type DocumentGenerationKind = "pdf_form" | "docx_placeholders";
export function isDocumentTemplateField(value: string): value is DocumentTemplateField { return Object.hasOwn(documentTemplateFields, value); }
