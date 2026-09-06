import {
  Activity,
  ArchiveRestore,
  CheckCircle2,
  CircleAlert,
  Database,
  FileArchive,
  HardDrive,
  LoaderCircle,
  MonitorDown,
  CloudOff,
  ShieldCheck,
} from "lucide-react";
import type { BackupRunListItem, BackupSystemSnapshot } from "@/server/backups/types";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

function formatBytes(bytes: number | null) {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
}

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "Ещё не выполнялось";
}

function runDuration(run: BackupRunListItem) {
  if (!run.completedAt) return "Выполняется";
  const seconds = Math.max(0, Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000));
  return seconds < 60 ? `${seconds} сек` : `${Math.floor(seconds / 60)} мин ${seconds % 60} сек`;
}

function formatInterval(milliseconds: number | undefined) {
  if (!milliseconds) return "После первого запуска";
  const minutes = milliseconds / 60_000;
  if (Number.isInteger(minutes) && minutes < 60) return `Через ${minutes} мин`;
  const hours = milliseconds / 3_600_000;
  if (Number.isInteger(hours) && hours < 24) return `Каждые ${hours} ч`;
  const days = milliseconds / 86_400_000;
  return Number.isInteger(days) ? `Каждые ${days} дн` : `Каждые ${hours.toFixed(1)} ч`;
}

const workerPresentation = {
  not_started: { label: "Ожидает первого запуска", detail: "Воркер ещё не зарегистрировал heartbeat", tone: "text-[#8d979c]", dot: "bg-[#707a80]" },
  running: { label: "Создаёт резервную копию", detail: "Архив публикуется только после полной проверки", tone: "text-[#dbe86a]", dot: "bg-[var(--accent)]" },
  succeeded: { label: "Защита данных работает", detail: "Воркер доступен и последний цикл завершён", tone: "text-[#7bd1a9]", dot: "bg-[#69d3a4]" },
  failed: { label: "Последний цикл завершился ошибкой", detail: "Воркер повторит операцию по политике retry", tone: "text-[#e58c90]", dot: "bg-[#ef646a]" },
  stale: { label: "Heartbeat устарел", detail: "Проверьте контейнер backup-worker", tone: "text-[#e4a56c]", dot: "bg-[#ed8b45]" },
} as const;

function RunStatus({ run }: { run: BackupRunListItem }) {
  if (run.status === "running") return <span className="flex items-center gap-1.5 text-[10px] text-[#dbe86a]"><LoaderCircle className="size-3 animate-spin" />Выполняется</span>;
  if (run.status === "failed") return <span className="flex items-center gap-1.5 text-[10px] text-[#e58c90]"><CircleAlert className="size-3" />Ошибка</span>;
  return <span className="flex items-center gap-1.5 text-[10px] text-[#7bd1a9]"><CheckCircle2 className="size-3" />Проверен</span>;
}

export function BackupSystemPanel({ snapshot, preview }: { snapshot: BackupSystemSnapshot; preview: boolean }) {
  const worker = workerPresentation[snapshot.workerStatus];
  const latestRun = snapshot.runs[0] ?? null;
  const latestSuccessfulRun = snapshot.runs.find((run) => run.status === "succeeded") ?? null;
  const totalLatestBytes = latestSuccessfulRun && latestSuccessfulRun.databaseBytes !== null && latestSuccessfulRun.documentsBytes !== null
    ? latestSuccessfulRun.databaseBytes + latestSuccessfulRun.documentsBytes
    : null;

  return <div className="mt-5 grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
    <div className="grid content-start gap-4">
      <section className="surface-panel overflow-hidden">
        <div className="border-b border-white/[0.06] p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-[13px] border border-[var(--accent)]/10 bg-[var(--accent)]/[0.055] text-[var(--accent)]"><ShieldCheck className="size-5" /></span>
              <div><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Контур сохранности</p><h2 className="mt-1 font-display text-lg font-semibold text-white">Резервное копирование</h2><p className="mt-2 max-w-xl text-xs leading-5 text-[#748087]">PostgreSQL и закрытое файловое хранилище архивируются вместе. Каждый архив проходит SHA‑256 и настоящее тестовое восстановление.</p></div>
            </div>
            <div className={`flex shrink-0 items-center gap-2 rounded-full border border-white/[0.07] bg-black/15 px-3 py-2 text-[10px] ${worker.tone}`}><span className={`size-2 rounded-full ${worker.dot} ${snapshot.workerStatus === "running" ? "animate-pulse" : ""}`} />{worker.label}</div>
          </div>
        </div>
        <div className="grid gap-px bg-white/[0.055] sm:grid-cols-3">
          {[
            { icon: Activity, label: "Heartbeat", value: formatDate(snapshot.heartbeatAt) },
            { icon: ArchiveRestore, label: "Последний успех", value: formatDate(snapshot.lastSucceededAt) },
            { icon: HardDrive, label: "Размер комплекта", value: formatBytes(totalLatestBytes) },
          ].map(({ icon: Icon, label, value }) => <div key={label} className="bg-[#10171b] p-5"><Icon className="size-4 text-[#657179]" /><p className="mt-4 text-[9px] uppercase tracking-[0.13em] text-[#59656c]">{label}</p><p className="mt-1 text-xs font-medium text-[#dce1de]">{value}</p></div>)}
        </div>
      </section>

      <section className="surface-panel overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4"><div><h2 className="font-display text-sm font-semibold text-white">История операций</h2><p className="mt-1 text-[10px] text-[#657078]">Последние 12 запусков без раскрытия содержимого архивов</p></div><span className="rounded-full bg-white/[0.035] px-2.5 py-1 text-[9px] text-[#6e797f]">{snapshot.runs.length}</span></div>
        {snapshot.runs.length ? <div className="divide-y divide-white/[0.055]">{snapshot.runs.map((run) => <article key={run.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><RunStatus run={run} /><span className="text-[9px] text-[#59646b]">·</span><time dateTime={run.startedAt} className="text-[10px] text-[#79838a]">{formatDate(run.startedAt)}</time></div><p className="mt-1.5 truncate font-mono text-[10px] text-[#5d686f]">{run.archiveName ?? `run:${run.id.slice(0, 8)}`}</p>{run.failureCode ? <p className="mt-1 text-[9px] text-[#b8767a]">Код: {run.failureCode}</p> : null}</div>
          <div className="flex gap-5 sm:justify-end"><div><p className="text-[9px] text-[#59646b]">База</p><p className="mt-1 text-[10px] text-[#a6afb3]">{formatBytes(run.databaseBytes)}</p></div><div><p className="text-[9px] text-[#59646b]">Файлы</p><p className="mt-1 text-[10px] text-[#a6afb3]">{formatBytes(run.documentsBytes)}</p></div></div>
          <div className="flex items-center justify-between gap-4 sm:block sm:text-right"><p className="text-[9px] text-[#59646b]">{run.restoreVerifiedAt ? "Restore проверен" : run.status === "failed" ? "Нужна диагностика" : "Проверка идёт"}</p><p className="mt-1 text-[10px] text-[#a6afb3]">{runDuration(run)}</p></div>
        </article>)}</div> : <div className="grid min-h-52 place-items-center p-8 text-center"><div><Database className="mx-auto size-7 text-[#4f5b62]" /><p className="mt-3 text-xs text-[#899399]">История появится после первого запуска backup-worker.</p>{preview ? <p className="mt-2 text-[10px] text-[#626d74]">В preview-режиме инфраструктурные операции отключены.</p> : null}</div></div>}
      </section>
    </div>

    <aside className="grid content-start gap-4 sm:grid-cols-2 2xl:grid-cols-1">
      <section className="surface-panel p-5"><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#68747b]">Места хранения</p><div className="mt-4 space-y-2">{[
        { icon: HardDrive, label: "Защищённый Docker volume", detail: "Основная проверенная копия", active: true },
        { icon: MonitorDown, label: "ПК или отдельный диск", detail: snapshot.storage.hostExportEnabled ? `Скопировано: ${formatDate(snapshot.storage.hostExportedAt)}` : "Задайте CRM_BACKUP_EXPORT_PATH", active: snapshot.storage.hostExportEnabled },
        { icon: CloudOff, label: "Внешнее S3-хранилище", detail: "Не настроено: нужны адрес и ключи", active: false },
      ].map(({ icon: Icon, label, detail, active }) => <div key={label} className="flex items-center gap-3 rounded-[12px] border border-white/[0.055] bg-black/10 p-3"><span className={`grid size-9 shrink-0 place-items-center rounded-[10px] ${active ? "bg-[#69d3a4]/[0.07] text-[#69d3a4]" : "bg-white/[0.03] text-[#667178]"}`}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs text-[#d4dad6]">{label}</p><span className={`size-1.5 shrink-0 rounded-full ${active ? "bg-[#69d3a4]" : "bg-[#59636a]"}`} /></div><p className="mt-1 truncate text-[9px] text-[#606b72]">{detail}</p></div></div>)}</div><p className="mt-4 text-[9px] leading-4 text-[#59646b]">Путь экспорта задаётся на сервере, поэтому браузер не получает файловый путь или доступ к резервным копиям.</p></section>
      <section className="surface-panel p-5"><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#68747b]">Последний комплект</p><div className="mt-5 space-y-3">{[
        { icon: Database, label: "PostgreSQL", value: formatBytes(latestSuccessfulRun?.databaseBytes ?? null) },
        { icon: FileArchive, label: "Документы", value: formatBytes(latestSuccessfulRun?.documentsBytes ?? null) },
        { icon: ArchiveRestore, label: "Восстановление", value: latestSuccessfulRun?.restoreVerifiedAt ? "Успешно" : "Нет проверки" },
      ].map(({ icon: Icon, label, value }) => <div key={label} className="flex items-center gap-3 rounded-[12px] border border-white/[0.055] bg-black/10 p-3"><span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.035] text-[#7a858b]"><Icon className="size-4" /></span><div className="min-w-0"><p className="text-[9px] text-[#606b72]">{label}</p><p className="mt-1 truncate text-xs text-[#d4dad6]">{value}</p></div></div>)}</div></section>
      <section className="surface-panel p-5"><h3 className="font-display text-sm font-semibold text-white">Политика</h3><dl className="mt-4 space-y-3 text-[10px]"><div className="flex justify-between gap-4"><dt className="text-[#68737a]">Периодичность</dt><dd className="text-[#afb7b3]">{formatInterval(snapshot.policy?.backupIntervalMs)}</dd></div><div className="flex justify-between gap-4"><dt className="text-[#68737a]">Хранение</dt><dd className="text-[#afb7b3]">{snapshot.policy ? `${snapshot.policy.retentionDays} дней` : "После первого запуска"}</dd></div><div className="flex justify-between gap-4"><dt className="text-[#68737a]">Повтор после ошибки</dt><dd className="text-[#afb7b3]">{formatInterval(snapshot.policy?.retryIntervalMs)}</dd></div></dl><p className="mt-5 border-l border-[var(--accent)]/30 pl-3 text-[10px] leading-5 text-[#737e84]">Архив сначала пишется во временный каталог и становится доступен только после завершения обеих частей. Неуспешный restore не считается успешной копией.</p></section>
      {latestRun?.status === "failed" || snapshot.workerStatus === "stale" ? <section className="rounded-[15px] border border-[#ef646a]/15 bg-[#ef646a]/[0.045] p-5"><div className="flex items-center gap-2 text-xs font-medium text-[#e39a9d]"><CircleAlert className="size-4" />Требуется внимание</div><p className="mt-2 text-[10px] leading-5 text-[#a77f82]">Проверьте `docker compose logs backup-worker`. Ошибка остаётся видимой и не подменяется старым успешным состоянием.</p></section> : null}
      <p className="px-1 text-[9px] leading-4 text-[#505c63]">{worker.detail}. Основной volume закрыт от приложения, а дополнительная копия экспортируется только серверным воркером.</p>
    </aside>
  </div>;
}
