export const documentCategories = [
  "contract",
  "act",
  "visit_card",
  "invoice",
  "receipt",
  "photo",
  "other",
] as const;
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

export type DocumentVersionListItem = {
  id: string;
  versionNumber: number;
  filename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  changeNote: string | null;
  uploadedAt: string;
  uploadedBy: string;
  current: boolean;
};

export type DocumentListItem = {
  id: string;
  folderId: string | null;
  contractId: string | null;
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
  recordVersion: number;
  uploadedAt: string;
  uploadedBy: string;
  favorite: boolean;
  versions: DocumentVersionListItem[];
};

export type DocumentOrderOption = {
  id: string;
  clientId: string;
  objectId: string;
  number: string;
  client: string;
  object: string;
  address: string;
};

export type DocumentContractOption = {
  id: string;
  contractNumber: string;
  clientId: string;
  objectId: string;
  clientName: string;
  objectName: string;
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
  contracts: DocumentContractOption[];
};

export type DocumentFolder = {
  id: string;
  parentFolderId: string | null;
  name: string;
  documentCount: number;
  updatedAt: string;
};

export type DocumentDownload = {
  id: string;
  documentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
};

export type DocumentExportFile = DocumentDownload & {
  clientId: string;
  clientName: string;
  objectId: string;
  objectName: string;
  orderNumber: string;
  category: DocumentCategory;
};

export type DocumentVersionUploadTarget = {
  documentId: string;
  orderId: string;
  recordVersion: number;
  versionNumber: number;
};
