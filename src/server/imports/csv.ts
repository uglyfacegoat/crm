import type { ParsedCsv } from "./types";

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

function detectDelimiter(source: string): ";" | "," {
  let semicolons = 0;
  let commas = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (character === "\n" || character === "\r")) {
      break;
    } else if (!quoted && character === ";") semicolons += 1;
    else if (!quoted && character === ",") commas += 1;
  }
  return semicolons >= commas ? ";" : ",";
}

export function parseCsv(sourceValue: string): ParsedCsv {
  const source = sourceValue.charCodeAt(0) === 0xfeff ? sourceValue.slice(1) : sourceValue;
  if (source.includes("\0")) throw new CsvParseError("CSV содержит недопустимый нулевой байт.");
  if (!source.trim()) throw new CsvParseError("CSV-файл пуст.");

  const delimiter = detectDelimiter(source);
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;

  function pushField() {
    record.push(field.trim());
    field = "";
    quoteClosed = false;
  }

  function pushRecord() {
    pushField();
    if (record.some((value) => value.length > 0)) records.push(record);
    record = [];
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        quoteClosed = true;
      } else field += character;
      continue;
    }
    if (character === '"') {
      if (field.trim() || quoteClosed) throw new CsvParseError("Кавычка должна открывать поле, а не находиться внутри значения.");
      field = "";
      quoted = true;
    } else if (character === delimiter) pushField();
    else if (character === "\n") pushRecord();
    else if (character === "\r") {
      if (source[index + 1] === "\n") index += 1;
      pushRecord();
    } else {
      if (quoteClosed && character.trim()) throw new CsvParseError("После закрывающей кавычки разрешён только разделитель.");
      if (!quoteClosed) field += character;
    }
  }
  if (quoted) throw new CsvParseError("В CSV не закрыта кавычка.");
  if (field.length || record.length) pushRecord();
  if (!records.length) throw new CsvParseError("CSV-файл не содержит заголовков.");

  const headers = records[0].map((header) => header.trim().toLowerCase());
  if (headers.some((header) => !header)) throw new CsvParseError("Все столбцы CSV должны иметь заголовки.");
  if (new Set(headers).size !== headers.length) throw new CsvParseError("Заголовки столбцов CSV не должны повторяться.");

  const rows = records.slice(1).map((values, index) => {
    if (values.length !== headers.length) throw new CsvParseError(`Строка ${index + 2}: ожидалось ${headers.length} столбцов, получено ${values.length}.`);
    return { rowNumber: index + 2, values: Object.fromEntries(headers.map((header, column) => [header, values[column]])) };
  });
  return { headers, rows, delimiter };
}
