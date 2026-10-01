import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFTextField, TextAlignment, layoutMultilineText } from "pdf-lib";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { documentTemplateFields, isDocumentTemplateField, type DocumentTemplateField, type DocumentGenerationKind } from "@/lib/document-template-fields";
import { hasBoundedZip } from "../file-scan/zip-bounds.mjs";

export class DocumentTemplateGenerationError extends Error {
  constructor(message: string) { super(message); this.name = "DocumentTemplateGenerationError"; }
}
export type TemplateGenerationMetadata = { generationKind: DocumentGenerationKind | null; generationFields: DocumentTemplateField[]; generationDefaults: Record<string, string> };
const emptyMetadata: TemplateGenerationMetadata = { generationKind: null, generationFields: [], generationDefaults: {} };
const partName = (name: string) => /^word\/(?:document|header\d+|footer\d+)\.xml$/.test(name);
const decodeXml = (text: string) => text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, entity: string) => {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  if (entity.startsWith("#")) { const point = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10); return point <= 0x10ffff ? String.fromCodePoint(point) : ""; }
  return named[entity];
});
const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
function readDocx(buffer: Buffer, all = false) {
  if (!hasBoundedZip(buffer, { requiredPrefix: "word/" })) throw new DocumentTemplateGenerationError("DOCX повреждён или слишком велик.");
  return unzipSync(buffer, all ? undefined : { filter: file => partName(file.name) });
}
function paragraphText(xml: string) { return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => decodeXml(match[1])).join(""); }
export async function inspectGenerationTemplate(buffer: Buffer, extension: "pdf" | "docx"): Promise<TemplateGenerationMetadata> {
  if (extension === "pdf") {
    const pdf = await PDFDocument.load(buffer);
    const fields = pdf.getForm().getFields().filter(field => field instanceof PDFTextField);
    if (!fields.length || fields.some(field => !isDocumentTemplateField(field.getName()))) return emptyMetadata;
    return { generationKind: "pdf_form", generationFields: fields.map(field => field.getName() as DocumentTemplateField),
      generationDefaults: Object.fromEntries(fields.map(field => [field.getName(), (field as PDFTextField).getText() ?? ""])) };
  }
  const keys = new Set<string>();
  for (const data of Object.values(readDocx(buffer))) for (const paragraph of strFromU8(data).matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    for (const match of paragraphText(paragraph[0]).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) keys.add(match[1]);
  }
  if (!keys.size || [...keys].some(key => !isDocumentTemplateField(key))) return emptyMetadata;
  return { generationKind: "docx_placeholders", generationFields: [...keys] as DocumentTemplateField[], generationDefaults: {} };
}

function fillParagraph(xml: string, values: Record<DocumentTemplateField, string>) {
  const matches = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
  let offset = 0;
  const runs = matches.map(match => { const value = decodeXml(match[1]); const run = { value, start: offset, end: offset + value.length }; offset += value.length; return run; });
  const joined = runs.map(run => run.value).join("");
  for (const token of [...joined.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].reverse()) {
    if (!isDocumentTemplateField(token[1])) throw new DocumentTemplateGenerationError(`Неизвестное поле шаблона: ${token[1]}`);
    const start = token.index!, end = start + token[0].length;
    for (const run of runs) if (run.end > start && run.start < end) {
      const left = Math.max(0, start - run.start), right = Math.min(run.end - run.start, end - run.start);
      run.value = run.value.slice(0, left) + (run.start <= start ? values[token[1]] : "") + run.value.slice(right);
    }
  }
  let index = 0;
  return xml.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (_match, open: string, _text: string, close: string) =>
    `${open.replace(/\sxml:space="[^"]*"/, "").replace(/>$/, ' xml:space="preserve">')}${escapeXml(runs[index++].value).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">')}${close}`);
}

export async function renderTemplateDocument(buffer: Buffer, kind: DocumentGenerationKind, values: Record<DocumentTemplateField, string>, documentDate = "2000-01-01") {
  if (kind === "docx_placeholders") {
    const parts = readDocx(buffer, true);
    for (const [name, data] of Object.entries(parts)) if (partName(name)) parts[name] = strToU8(strFromU8(data).replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => fillParagraph(paragraph, values)));
    return Buffer.from(zipSync(Object.fromEntries(Object.entries(parts).map(([name, data]) => [name, [data, { mtime: new Date("2000-01-01T12:00:00Z") }]]))));
  }
  const pdf = await PDFDocument.load(buffer);
  pdf.registerFontkit(fontkit);
  pdf.setCreationDate(new Date(`${documentDate}T12:00:00Z`));
  pdf.setModificationDate(new Date(`${documentDate}T12:00:00Z`));
  const font = await pdf.embedFont(await readFile(resolve(process.cwd(), "src/server/document-templates/assets/DejaVuSans.ttf")), { subset: true });
  const form = pdf.getForm();
  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField)) continue;
    const name = field.getName();
    if (!isDocumentTemplateField(name)) throw new DocumentTemplateGenerationError(`Неизвестное поле шаблона: ${name}`);
    const value = values[name];
    let chosenSize = 10;
    for (const widget of field.acroField.getWidgets()) {
      const bounds = widget.getRectangle();
      let fits = false;
      for (const size of [chosenSize, 9, 8]) {
        if (size > chosenSize) continue;
        const width = Math.max(1, bounds.width - 6), height = Math.max(1, bounds.height - 3);
        const layout = field.isMultiline() ? layoutMultilineText(value, { alignment: TextAlignment.Left, fontSize: size, font, bounds: { x: 0, y: 0, width, height } }) : null;
        if (layout ? layout.lines.length * layout.lineHeight <= height : !value.includes("\n") && font.widthOfTextAtSize(value, size) <= width) { chosenSize = size; fits = true; break; }
      }
      if (!fits) throw new DocumentTemplateGenerationError(`Текст «${documentTemplateFields[name]}» не помещается в форму. Сократите его перед генерацией.`);
    }
    field.setFontSize(chosenSize); field.setText(value);
  }
  form.updateFieldAppearances(font);
  form.flatten();
  return Buffer.from(await pdf.save());
}
