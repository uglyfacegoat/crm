"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileSearch, FileSpreadsheet, LoaderCircle, ShieldCheck, UploadCloud } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createImportDryRunAction, type ImportDryRunState } from "@/app/(workspace)/settings/import-actions";
import { importDatasetNames, type ImportDatasetName, type ImportDryRunReport, type ImportJobListItem } from "@/server/imports/types";

const datasetPresentation: Record<ImportDatasetName, { label: string; description: string }> = {
  clients: { label: "Клиенты", description: "Юрлица, ИП и контакты" },
  objects: { label: "Объекты", description: "Адреса и типы помещений" },
  orders: { label: "Заказы", description: "Статусы, суммы и связи" },
  services: { label: "Состав заказов", description: "Услуги, количество и цены" },
  documents: { label: "Документы", description: "Метаданные и имена файлов" },
};

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const initialImportDryRunState: ImportDryRunState = { status: "idle", message: null, fieldErrors: {}, report: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-5 text-xs font-semibold text-[#25272c] transition-colors hover:bg-[#b8f7e4] disabled:cursor-wait disabled:opacity-70 sm:w-auto sm:min-w-52">{pending ? <><LoaderCircle className="size-4 animate-spin" />Проверяем пакет</> : <><FileSearch className="size-4" />Запустить dry-run</>}</button>;
}

function Report({ report }: { report: ImportDryRunReport }) {
  const blocked = report.status === "blocked";
  return <section className="surface-panel mt-4 overflow-hidden" aria-live="polite">
    <div className={`border-b p-5 sm:p-6 ${blocked ? "border-[#ef646a]/15 bg-[#ef646a]/[0.025]" : "border-[#b8f7e4]/15 bg-[#b8f7e4]/[0.025]"}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3">{blocked ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#ef767b]" /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#b8f7e4]" />}<div><p className={`text-[9px] font-semibold uppercase tracking-[0.18em] ${blocked ? "text-[#d98084]" : "text-[#b8f7e4]"}`}>{blocked ? "Применение заблокировано" : "Структура готова"}</p><h3 className="mt-1 font-display text-lg font-semibold text-white">{blocked ? "Найдены ошибки в пакете" : "Dry-run пройден"}</h3><p className="mt-2 text-xs leading-5 text-[#778188]">{report.reused ? "Пакет совпал с ранее проверенным: новый журнал не создавался." : "Ни клиенты, ни заказы, ни документы не были записаны в рабочие таблицы."}</p></div></div><div className="flex shrink-0 gap-2"><span className="rounded-full border border-[#ef646a]/15 bg-[#ef646a]/[0.05] px-3 py-1.5 text-[10px] text-[#dc8488]">{report.errorCount} ошибок</span><span className="rounded-full border border-[#e5b45e]/15 bg-[#e5b45e]/[0.05] px-3 py-1.5 text-[10px] text-[#d0a45c]">{report.warningCount} предупреждений</span></div></div>
    </div>
    <div className="grid gap-px bg-white/[0.055] sm:grid-cols-5">{importDatasetNames.map((dataset) => <div key={dataset} className="bg-[#2b2e34] px-4 py-4"><p className="text-[9px] text-[#5e696f]">{datasetPresentation[dataset].label}</p><p className="mt-1 font-display text-lg font-semibold text-[#dce1de]">{report.counts[dataset]}</p></div>)}</div>
    {report.issues.length ? <div className="max-h-[28rem] divide-y divide-white/[0.055] overflow-y-auto">{report.issues.map((issue, index) => <article key={`${issue.dataset}-${issue.rowNumber}-${issue.code}-${index}`} className="grid gap-2 px-5 py-3.5 sm:grid-cols-[7rem_4rem_minmax(0,1fr)] sm:items-center"><span className={`w-fit rounded-full px-2 py-1 text-[9px] ${issue.severity === "error" ? "bg-[#ef646a]/[0.08] text-[#df8589]" : "bg-[#e5b45e]/[0.08] text-[#d4aa63]"}`}>{issue.severity === "error" ? "Ошибка" : "Проверить"}</span><span className="text-[10px] text-[#657078]">{issue.dataset} · {issue.rowNumber}</span><p className="text-[11px] leading-5 text-[#aeb6b2]">{issue.message}</p></article>)}</div> : <div className="flex items-center gap-3 px-5 py-5 text-xs text-[#8ebda7]"><ShieldCheck className="size-4" />Связи и суммы согласованы, блокирующих ошибок нет.</div>}
  </section>;
}

export function ImportPanel({ jobs, preview }: { jobs: ImportJobListItem[]; preview: boolean }) {
  const [state, formAction] = useActionState(createImportDryRunAction, initialImportDryRunState);
  const [selectedFiles, setSelectedFiles] = useState<Partial<Record<ImportDatasetName, string>>>({});
  return <div className="mt-5 grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
    <div className="min-w-0">
      <section className="surface-panel overflow-hidden">
        <div className="border-b border-white/[0.06] p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-[13px] border border-[var(--accent)]/10 bg-[var(--accent)]/[0.055] text-[var(--accent)]"><UploadCloud className="size-5" /></span><div><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Перенос данных</p><h2 className="mt-1 font-display text-lg font-semibold text-white">Проверка выгрузки старой CRM</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-[#748087]">Загрузите нормализованные CSV. Проверка найдёт битые связи, повторные ID, существующие ИНН и расхождения состава заказа до любых изменений рабочих данных.</p></div></div></div>
        <form action={formAction} className="p-5 sm:p-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{importDatasetNames.map((dataset) => { const presentation = datasetPresentation[dataset]; const error = state.fieldErrors[`${dataset}File`]?.[0]; return <label key={dataset} className={`focus-within:border-[var(--accent)]/35 group cursor-pointer rounded-[14px] border bg-black/10 p-4 transition-colors ${error ? "border-[#ef646a]/30" : "border-white/[0.065] hover:border-white/[0.12]"}`}><input type="file" name={`${dataset}File`} accept=".csv,text/csv" className="sr-only" onChange={(event) => setSelectedFiles((current) => ({ ...current, [dataset]: event.target.files?.[0]?.name }))} /><span className="flex items-start justify-between gap-3"><span><span className="block text-xs font-medium text-[#dce1de]">{presentation.label}</span><span className="mt-1 block text-[9px] leading-4 text-[#626d74]">{presentation.description}</span></span><FileSpreadsheet className="size-4 shrink-0 text-[#667178] group-hover:text-[var(--accent)]" /></span><span className={`mt-4 block truncate text-[10px] ${selectedFiles[dataset] ? "text-[var(--accent)]" : "text-[#515d64]"}`}>{selectedFiles[dataset] ?? "Выбрать .csv"}</span>{error ? <span className="mt-2 block text-[9px] text-[#df8589]">{error}</span> : null}</label>; })}</div>
          <div className="mt-5 flex flex-col gap-4 border-t border-white/[0.055] pt-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] text-[#737e84]">UTF‑8 · до 2 МБ на файл · до 50 000 строк в пакете</p><p className="mt-1 text-[9px] text-[#535f66]">Повторная отправка того же пакета безопасно вернёт прежний отчёт.</p></div><SubmitButton /></div>
          {state.message ? <p className={`mt-4 rounded-[10px] border px-3 py-2.5 text-[10px] ${state.status === "error" ? "border-[#ef646a]/15 bg-[#ef646a]/[0.04] text-[#d6868a]" : "border-white/[0.06] bg-white/[0.025] text-[#9ca5a2]"}`}>{state.message}</p> : null}
        </form>
      </section>
      {state.report ? <Report report={state.report} /> : null}
    </div>

    <aside className="grid content-start gap-4 sm:grid-cols-2 2xl:grid-cols-1">
      <section className="surface-panel p-5"><h3 className="font-display text-sm font-semibold text-white">Шаблоны CRM CSV v1</h3><p className="mt-2 text-[10px] leading-5 text-[#69747b]">Сначала приведите колонки старой CRM к этим названиям. Разделитель может быть запятой или точкой с запятой.</p><div className="mt-4 space-y-2">{importDatasetNames.map((dataset) => <a key={dataset} href={`/import-templates/${dataset}.csv`} download className="focus-ring flex h-10 items-center justify-between rounded-[10px] border border-white/[0.06] bg-black/10 px-3 text-[10px] text-[#9da6a2] hover:border-white/[0.12] hover:text-white"><span>{datasetPresentation[dataset].label}</span><Download className="size-3.5" /></a>)}</div></section>
      <section className="surface-panel p-5"><h3 className="font-display text-sm font-semibold text-white">Что происходит дальше</h3><ol className="mt-4 space-y-3">{["Исправляем блокирующие ошибки и подтверждаем кандидатов на объединение.", "Сопоставляем файлы документов с проверенными метаданными.", "Делаем тестовый импорт и ручную сверку контрольной выборки.", "Только после подтверждения применяем пакет к рабочей базе."].map((step, index) => <li key={step} className="flex gap-3 text-[10px] leading-5 text-[#78838a]"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/[0.04] text-[9px] text-[var(--accent)]">{index + 1}</span>{step}</li>)}</ol><p className="mt-5 border-l border-[var(--accent)]/25 pl-3 text-[9px] leading-4 text-[#59656c]">На этом экране импорт намеренно не применяется. Это защищает историю заказов, суммы и документы от частично загруженного пакета.</p></section>
      <section className="surface-panel overflow-hidden"><div className="flex items-center justify-between border-b border-white/[0.055] px-5 py-4"><h3 className="font-display text-sm font-semibold text-white">Последние проверки</h3><span className="text-[9px] text-[#5d686f]">{jobs.length}</span></div>{jobs.length ? <div className="divide-y divide-white/[0.055]">{jobs.map((job) => <div key={job.id} className="px-5 py-3.5"><div className="flex items-center justify-between gap-3"><span className={`text-[10px] ${job.status === "blocked" ? "text-[#df8589]" : job.status === "ready" ? "text-[#72c9a2]" : "text-[var(--accent)]"}`}>{job.status === "blocked" ? "Есть ошибки" : job.status === "ready" ? "Готов к сверке" : "Применён"}</span><span className="text-[9px] text-[#505c63]">{job.totalRows} строк</span></div><p className="mt-1.5 text-[9px] text-[#68737a]">{dateFormatter.format(new Date(job.createdAt))} · {job.createdByName}</p></div>)}</div> : <div className="p-5 text-[10px] leading-5 text-[#626d74]">{preview ? "В preview-режиме история недоступна." : "Проверок пока нет."}</div>}</section>
      <a href="/documents" className="focus-ring flex items-center justify-between rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[10px] text-[#78838a] hover:text-white"><span>Открыть архив документов</span><ArrowRight className="size-3.5" /></a>
    </aside>
  </div>;
}
