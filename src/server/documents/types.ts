export const documentCategories = ["contract", "act", "visit_card", "invoice", "receipt", "photo", "other"] as const;
export type DocumentCategory = (typeof documentCategories)[number];

export const documentCategoryLabels: Record<DocumentCategory, string> = {
  contract: "Договоры",
  act: "Акты",
  visit_card: "Выезды",
  invoice: "Счета",
  receipt: "Чеки",
  photo: "Фото",
  other: "Прочее",
};

export type DocumentListItem = {
  id: string;
  title: string;
  category: DocumentCategory;
  categoryLabel: string;
  description: string | null;
  clientId: string;
  clientName: string;
  objectId: string;
  objectName: string;
  objectAddress: string;
  orderId: string;
  orderNumber: string;
  visitId: string | null;
  visitScheduledStartAt: string | null;
  filename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  versionNumber: number;
  uploadedAt: string;
  uploadedBy: string;
  favorite: boolean;
};

export type DocumentOrderOption = {
  id: string;
  number: string;
  client: string;
  object: string;
  address: string;
};

export type DocumentVisitOption = {
  id: string;
  orderId: string;
  scheduledStartAt: string;
  status: string;
};

export type DocumentUploadOptions = {
  orders: DocumentOrderOption[];
  visits: DocumentVisitOption[];
};

export type DocumentDownload = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
};
