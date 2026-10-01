import type { DocumentGenerationKind, DocumentTemplateField } from "@/lib/document-template-fields";

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
  generationKind?: DocumentGenerationKind | null;
  generationFields?: DocumentTemplateField[];
  generationDefaults?: Record<string, string>;
};

export type DocumentTemplateDownload = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
};

export type OrderGenerationTemplate = Pick<DocumentTemplateListItem, "id" | "title" | "version" | "extension" | "generationKind" | "generationFields" | "generationDefaults">;
