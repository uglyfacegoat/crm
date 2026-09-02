export const importDatasetNames = ["clients", "objects", "orders", "services", "documents"] as const;
export type ImportDatasetName = (typeof importDatasetNames)[number];
export type ImportIssueDataset = "package" | ImportDatasetName;
export type ImportRecordType = "client" | "object" | "order" | "service" | "document";

export type CsvRow = { rowNumber: number; values: Record<string, string> };
export type ParsedCsv = { headers: string[]; rows: CsvRow[]; delimiter: ";" | "," };

export type ImportIssue = {
  dataset: ImportIssueDataset;
  rowNumber: number;
  severity: "error" | "warning";
  code: string;
  field: string | null;
  message: string;
};

export type ImportPackageRows = Partial<Record<ImportDatasetName, ParsedCsv>>;

export type ImportValidationContext = {
  existingClientTaxIds: ReadonlySet<string>;
  existingOrderNumbers: ReadonlySet<string>;
  existingLinks: ReadonlySet<string>;
};

export type ImportValidationResult = {
  status: "ready" | "blocked";
  totalRows: number;
  errorCount: number;
  warningCount: number;
  counts: Record<ImportDatasetName, number>;
  issues: ImportIssue[];
};

export type ImportJobListItem = {
  id: string;
  status: "ready" | "blocked" | "applied";
  totalRows: number;
  errorCount: number;
  warningCount: number;
  sourceFiles: Partial<Record<ImportDatasetName, string>>;
  counts: Record<ImportDatasetName, number>;
  createdAt: string;
  createdByName: string;
};

export type ImportDryRunReport = ImportJobListItem & { issues: ImportIssue[]; reused: boolean };
