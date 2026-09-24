import type { Metadata } from "next";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileCheck2,
  GitBranch,
  Grip,
  MessageSquareText,
  MousePointer2,
  Network,
  Plus,
  Route,
  Sparkles,
  StickyNote,
  UsersRound,
} from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";
import { requireOfficeSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Воркфлоу" };

const blockLibrary = [
  { label: "Событие", icon: Sparkles, tone: "text-[var(--accent-ink)] bg-[var(--accent-soft)]" },
  { label: "Карточка CRM", icon: ClipboardList, tone: "text-[var(--support-strong)] bg-[var(--support-soft)]" },
  { label: "Условие", icon: GitBranch, tone: "text-[var(--warning)] bg-[var(--warning-bg)]" },
  { label: "Действие", icon: Bot, tone: "text-[var(--success)] bg-[var(--success-bg)]" },
  { label: "Заметка", icon: StickyNote, tone: "text-[var(--muted)] bg-[var(--surface-soft)]" },
] as const;

const processNodes = [
  { id: "01", title: "Новая заявка", note: "Сайт или оператор", icon: MessageSquareText, tone: "accent" },
  { id: "02", title: "Проверка данных", note: "Контакт, адрес, услуга", icon: CheckCircle2, tone: "support" },
  { id: "03", title: "Заказ и выезд", note: "Мастер и расписание", icon: Route, tone: "warning" },
  { id: "04", title: "Закрывающий акт", note: "Документы и результат", icon: FileCheck2, tone: "success" },
  { id: "05", title: "Оплата и повтор", note: "Финансы и удержание", icon: CircleDollarSign, tone: "accent" },
] as const;

const toneClasses = {
  accent: "border-[var(--accent)]/35 bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  support: "border-[var(--support)]/35 bg-[var(--support-soft)] text-[var(--support-strong)]",
  warning: "border-[var(--warning)]/35 bg-[var(--warning-bg)] text-[var(--warning)]",
  success: "border-[var(--success)]/35 bg-[var(--success-bg)] text-[var(--success)]",
} as const;

export default async function WorkflowPage() {
  await requireOfficeSession();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Процессы компании"
        title="Воркфлоу"
        description="Общее пространство для карт процессов, связанных карточек CRM, регламентов и будущих автоматизаций. Сейчас доступен концепт структуры без редактирования."
        action={<span className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface-raised)] px-4 text-xs text-[var(--text-secondary)]"><span className="size-2 rounded-full bg-[var(--warning)]" />Концепт · только просмотр</span>}
      />

      <section className="surface-panel flex min-h-[650px] min-w-0 flex-1 flex-col overflow-hidden p-0" aria-label="Предпросмотр пространства процессов">
        <header className="flex min-h-14 flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--surface-raised)] px-4 py-2 sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--accent-soft)] text-[var(--accent-ink)]"><Network className="size-4" /></span>
            <div className="min-w-0"><h2 className="truncate text-sm font-semibold text-[var(--text)]">Путь заявки до повторного заказа</h2><p className="mt-0.5 text-[10px] text-[var(--muted)]">Черновик операционного процесса</p></div>
          </div>
          <div className="flex items-center gap-1 rounded-[11px] border border-[var(--line)] bg-[var(--surface-inset)] p-1 text-[10px] text-[var(--muted)]">
            <span className="rounded-[8px] bg-[var(--surface-raised)] px-3 py-2 text-[var(--text-secondary)] shadow-sm">Карта</span>
            <span className="px-3 py-2">Документ</span>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[13rem_minmax(0,1fr)_15rem]">
          <aside className="border-b border-[var(--line)] bg-[var(--surface-raised)] p-4 lg:border-b-0 lg:border-r">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Библиотека блоков</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {blockLibrary.map(({ label, icon: Icon, tone }) => <div key={label} className="flex min-h-11 items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3 text-xs text-[var(--text-secondary)]"><span className={`grid size-7 place-items-center rounded-[9px] ${tone}`}><Icon className="size-3.5" /></span><span className="flex-1">{label}</span><Grip className="size-3.5 text-[var(--muted)]" /></div>)}
            </div>
            <div className="mt-5 rounded-[14px] border border-dashed border-[var(--line-strong)] p-4">
              <Plus className="size-4 text-[var(--muted)]" />
              <p className="mt-3 text-xs font-medium text-[var(--text-secondary)]">Свои шаблоны</p>
              <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">На следующем этапе здесь появятся повторно используемые процессы компании.</p>
            </div>
          </aside>

          <div
            className="relative min-h-[430px] overflow-hidden bg-[var(--surface-inset)] p-5 sm:p-8"
            style={{ backgroundImage: "radial-gradient(var(--line-strong) 1px, transparent 1px)", backgroundSize: "24px 24px" }}
          >
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-[11px] border border-[var(--line)] bg-[var(--surface-raised)] p-1.5 shadow-sm">
              <span className="grid size-8 place-items-center rounded-[8px] bg-[var(--accent)] text-[var(--on-accent)]" aria-label="Инструмент выбора"><MousePointer2 className="size-3.5" /></span>
              <span className="grid size-8 place-items-center rounded-[8px] text-[var(--muted)]" aria-label="Инструмент связи"><Network className="size-3.5" /></span>
              <span className="grid size-8 place-items-center rounded-[8px] text-[var(--muted)]" aria-label="Инструмент заметки"><StickyNote className="size-3.5" /></span>
            </div>

            <div className="mx-auto flex min-h-full max-w-5xl flex-col items-stretch justify-center gap-3 pt-14 xl:flex-row xl:items-center xl:gap-2 xl:pt-0">
              {processNodes.map(({ id, title, note, icon: Icon, tone }, index) => <div key={id} className="contents">
                <article className={`relative min-w-0 flex-1 rounded-[16px] border p-4 shadow-[0_12px_32px_rgba(20,24,33,0.08)] ${toneClasses[tone]}`}>
                  <div className="flex items-start justify-between gap-3"><span className="grid size-9 place-items-center rounded-[11px] bg-[var(--surface-raised)]/85"><Icon className="size-4" /></span><span className="font-display text-[10px] opacity-65">{id}</span></div>
                  <h3 className="mt-5 text-sm font-semibold text-[var(--text)]">{title}</h3>
                  <p className="mt-1.5 text-[10px] leading-4 text-[var(--muted)]">{note}</p>
                </article>
                {index < processNodes.length - 1 ? <div className="flex h-6 shrink-0 items-center justify-center text-[var(--muted)] xl:h-auto xl:w-7"><ArrowRight className="size-4 rotate-90 xl:rotate-0" /></div> : null}
              </div>)}
            </div>

            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-[11px] border border-[var(--line)] bg-[var(--surface-raised)] p-1 text-[10px] text-[var(--muted)] shadow-sm"><span className="px-2 py-1.5">−</span><span className="min-w-12 border-x border-[var(--line)] px-2 py-1.5 text-center">100%</span><span className="px-2 py-1.5">+</span></div>
          </div>

          <aside className="border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 lg:border-l lg:border-t-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Контекст процесса</p>
            <div className="mt-4 rounded-[15px] border border-[var(--line)] bg-[var(--surface)] p-4">
              <span className="grid size-9 place-items-center rounded-[11px] bg-[var(--support-soft)] text-[var(--support-strong)]"><UsersRound className="size-4" /></span>
              <h3 className="mt-4 text-sm font-semibold text-[var(--text)]">Ответственные</h3>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Диспетчер, мастер, бухгалтер и руководитель видят свою часть одного процесса.</p>
            </div>
            <dl className="mt-3 divide-y divide-[var(--line)] rounded-[15px] border border-[var(--line)] bg-[var(--surface)] px-4">
              <div className="flex items-center justify-between gap-3 py-3"><dt className="text-[10px] text-[var(--muted)]">Связанные сущности</dt><dd className="font-display text-sm text-[var(--text)]">5</dd></div>
              <div className="flex items-center justify-between gap-3 py-3"><dt className="text-[10px] text-[var(--muted)]">Контрольные точки</dt><dd className="font-display text-sm text-[var(--text)]">4</dd></div>
              <div className="flex items-center justify-between gap-3 py-3"><dt className="text-[10px] text-[var(--muted)]">Автоматизации</dt><dd className="text-[10px] text-[var(--warning)]">не подключены</dd></div>
            </dl>
            <p className="mt-4 text-[10px] leading-4 text-[var(--muted)]">Редактирование, совместная работа, версии и запуск автоматизаций должны появляться только вместе с серверной моделью, правами и аудитом изменений.</p>
          </aside>
        </div>
      </section>
    </div>
  );
}
