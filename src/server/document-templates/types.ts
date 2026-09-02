export type DocumentTemplateListItem = {
  id: string;
  title: string;
  description: string | null;
  kind: "closing_act";
  active: boolean;
  filename: string;
  mimeType: string;
  extension: "pdf" | "docx";
  sizeBytes: number;
  sha256: string;
  versionNumber: number;
  uploadedAt: string;
  uploadedBy: string;
  version: number;
};

export type DocumentTemplateDownload = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
};
