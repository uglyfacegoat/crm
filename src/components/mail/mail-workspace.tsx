"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Inbox, Mail, PenSquare, RefreshCw, Reply, Search, Send, X } from "lucide-react";
import { composeMailAction, type ComposeMailResult } from "@/app/(workspace)/mail/actions";
import { OrderPicker } from "@/components/orders/order-form-parts";
import type { MailMessage, MailPage, MailSource, MailThreadPage, OutgoingMail } from "@/server/mail/repository";

type Folder = "inbox" | "sent";
type ReplyTarget = Pick<MailMessage, "id" | "sourceId" | "fromAddress" | "subject">;
type Item = { id: string; sourceId: string | null; address: string; subject: string; body: string;
  date: string; status?: OutgoingMail["status"]; fromAddress?: string; recipientAddress?: string };
const PAGE_SIZE = 30;
const initialResult: ComposeMailResult = { ok: false, message: "" };
const dateLabel = (value: string) => new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow",
}).format(new Date(value));
const statusLabel = (status: OutgoingMail["status"]) =>
  status === "sent" ? "Отправлено" : status === "failed" ? "Ошибка отправки" : "В очереди";

export function MailWorkspace({ initialPage, sources, mailboxReady, outboundReady }: {
  initialPage: MailPage; sources: MailSource[];
  mailboxReady: boolean; outboundReady: boolean;
}) {
  const router = useRouter();
  const [source, setSource] = useState("all");
  const [folder, setFolder] = useState<Folder>("inbox");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [mailPage, setMailPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const initialLoad = useRef(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [requestKey, setRequestKey] = useState("");
  const [thread, setThread] = useState<(MailThreadPage & { key: string }) | null>(null);
  const [threadPage, setThreadPage] = useState(0);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState("");
  const [threadRetry, setThreadRetry] = useState(0);
  const [composeSource, setComposeSource] = useState("");
  const [draft, setDraft] = useState({ toAddress: "", subject: "", bodyText: "" });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [result, action, pending] = useActionState(async (previous: ComposeMailResult, form: FormData) => {
    try { return await composeMailAction(previous, form); }
    catch { return { ok: false, message: "Соединение прервалось. Черновик сохранён. Повторите отправку." }; }
  }, initialResult);
  const handledResult = useRef<ComposeMailResult | null>(null);
  const items = useMemo<Item[]>(() => folder === "inbox" ? mailPage.messages.map((message) => ({
    id: message.id, sourceId: message.sourceId,
    address: message.fromName ? `${message.fromName} · ${message.fromAddress}` : message.fromAddress,
    fromAddress: message.fromAddress, recipientAddress: message.recipientAddress || message.mailboxAddress,
    subject: message.subject, body: message.bodyText, date: message.receivedAt,
  })) : mailPage.sent.map((message) => ({
    id: message.id, sourceId: message.sourceId, address: message.toAddress,
    fromAddress: message.fromAddress, recipientAddress: message.toAddress,
    subject: message.subject, body: message.bodyText, date: message.sentAt || message.createdAt,
    status: message.status,
  })), [folder, mailPage]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const sourceName = sources.find((item) => item.id === source)?.address || "Все почтовые ящики";
  const currentMessage = folder === "inbox" ? mailPage.messages.find((item) => item.id === selectedId) ?? null : null;
  const threadKey = `${folder}:${selectedId}`;
  const visibleThread = thread?.key === threadKey ? thread : null;
  const replyTarget = visibleThread ? [...visibleThread.items].reverse().find(item => item.folder === "inbox" && item.sourceId) ?? currentMessage : currentMessage;

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setThreadLoading(true); setThreadError("");
      try {
        const params = new URLSearchParams({ id: selectedId, folder, page: String(threadPage) });
        const response = await fetch(`/api/v1/mail/thread?${params}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json() as { data?: MailThreadPage; error?: { message?: string } };
        if (!response.ok || !result.data) throw new Error(result.error?.message || "Не удалось загрузить переписку.");
        if (controller.signal.aborted) return;
        const data = result.data;
        setThread(previous => ({ ...data, key: threadKey, items: threadPage && previous?.key === threadKey
          ? [...data.items, ...previous.items].filter((item, index, all) => all.findIndex(other => other.id === item.id && other.folder === item.folder) === index)
          : data.items }));
      } catch (error) {
        if (!controller.signal.aborted) setThreadError(error instanceof Error ? error.message : "Не удалось загрузить переписку.");
      } finally { if (!controller.signal.aborted) setThreadLoading(false); }
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [selectedId, folder, threadPage, threadKey, threadRetry]);

  useEffect(() => {
    if (initialLoad.current) { initialLoad.current = false; return; }
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ folder, source, q: query.trim(), page: String(page) });
        const response = await fetch(`/api/v1/mail/messages?${params}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json() as { data?: MailPage; error?: { message?: string } };
        if (!response.ok || !result.data) throw new Error(result.error?.message || "Не удалось загрузить письма.");
        if (!controller.signal.aborted) setMailPage(result.data);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить письма.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query ? 220 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [folder, source, query, page, refreshKey]);

  useEffect(() => {
    if (!result.ok || handledResult.current === result) return;
    handledResult.current = result;
    const timer = window.setTimeout(() => {
      setComposeOpen(false);
      setReplyTo(null);
      setSource(composeSource);
      setFolder("sent");
      setSelectedId(null);
      setPage(0);
      setQuery("");
      setRefreshKey((value) => value + 1);
      router.refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [result, router, composeSource]);

  function openCompose(message: ReplyTarget | null = null) {
    setReplyTo(message);
    setComposeSource(message?.sourceId || (source === "all" ? sources[0]?.id : source) || "");
    setDraft({ toAddress: message?.fromAddress || "",
      subject: message ? (/^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject || "Без темы"}`) : "",
      bodyText: "" });
    setSubmitAttempted(false);
    setFormKey((value) => value + 1);
    setRequestKey(crypto.randomUUID());
    setComposeOpen(true);
  }
  function changeFolder(value: Folder) { setFolder(value); setSelectedId(null); setPage(0); setQuery(""); }

  return <div className="mail-workspace">
    <aside className="mail-sidebar" aria-label="Почтовые ящики и папки">
      <div className="mail-sidebar-title"><Mail className="size-5" /><strong>Почта</strong></div>
      <div className="mail-mailbox-picker"><OrderPicker label="Почтовый ящик" value={source} onChange={(value) => {
        setSource(value); setPage(0); setSelectedId(null);
      }} options={[{ value: "all", label: "Все ящики" }, ...sources.map((item) => ({ value: item.id, label: `${item.organizationName} · ${item.address}` }))]}
      placeholder="Все ящики" searchPlaceholder="Адрес или компания" /></div>
      <button type="button" className="mail-compose-button" onClick={() => openCompose()}><PenSquare className="size-4" />Написать письмо</button>
      <nav className="mail-folders" aria-label="Папки">
        <button type="button" aria-current={folder === "inbox" ? "page" : undefined} onClick={() => changeFolder("inbox")}>
          <Inbox className="size-4" />Входящие <span>{mailPage.counts.inbox}</span></button>
        <button type="button" aria-current={folder === "sent" ? "page" : undefined} onClick={() => changeFolder("sent")}>
          <Send className="size-4" />Отправленные <span>{mailPage.counts.sent}</span></button>
      </nav>
      <div className="mail-sidebar-foot"><Link href="/inbox">Заявки с сайтов <ArrowRight className="size-4" /></Link>
        <p>Письма хранятся в CRM. Заявки открываются отдельно.</p></div>
    </aside>

    <section className={`mail-list ${selected ? "mail-list-has-selection" : ""}`} aria-label="Список писем">
      <div className="mail-list-heading"><div><span className="mail-eyebrow">{sourceName}</span>
        <h1>{folder === "inbox" ? "Входящие" : "Отправленные"}</h1></div>
        <button type="button" className="mail-icon-button" title="Обновить письма" aria-label="Обновить письма" onClick={() => setRefreshKey((value) => value + 1)}>
          <RefreshCw className="size-[18px]" /></button></div>
      <div className="mail-search"><Search className="size-4" /><input type="search" value={query}
        onChange={(event) => { setQuery(event.target.value); setPage(0); setSelectedId(null); }}
        maxLength={200} placeholder="Найти письмо" aria-label="Найти письмо" /></div>
      {!mailboxReady && folder === "inbox" ? <div className="mail-notice">Приём внешних писем пока не настроен. Уже сохранённые письма доступны ниже.</div> : null}
      <div className="mail-list-scroll">{loadError ? <div className="mail-notice" role="alert">{loadError} <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>Повторить</button></div> : null}
        {loading ? <div className="mail-empty" role="status">Загружаем письма...</div> : items.map((item) => <button key={item.id} type="button"
        className={`mail-row ${selectedId === item.id ? "is-selected" : ""}`} onClick={() => {
          setSelectedId(item.id); setThreadPage(0); setThread(null); setThreadRetry(value => value + 1);
        }}>
        <span className="mail-row-avatar" aria-hidden="true">{item.address.trim().slice(0, 1).toLocaleUpperCase("ru-RU")}</span>
        <span className="mail-row-content"><span className="mail-row-top"><strong>{item.address}</strong>
          <time dateTime={item.date}>{dateLabel(item.date)}</time></span>
          <span className="mail-row-subject">{item.subject || "Без темы"}</span>
          <span className="mail-row-preview">{item.body || "Письмо без текста"}</span>
          {item.status ? <span className={`mail-row-status status-${item.status}`}>{statusLabel(item.status)}</span> : null}</span>
      </button>)}
        {!loading && !loadError && !items.length ? <div className="mail-empty"><Mail className="size-7" /><strong>{query ? "Ничего не найдено" : "Писем пока нет"}</strong>
          <span>{query ? "Измените запрос или выберите другой ящик." : "Когда письма поступят, они появятся здесь."}</span></div> : null}
      </div>
      {!loading && !loadError && mailPage.total > PAGE_SIZE ? <div className="mail-pagination">
        <button type="button" disabled={page === 0} onClick={() => { setPage(page - 1); setSelectedId(null); }}>Назад</button>
        <span>{page + 1} / {Math.ceil(mailPage.total / PAGE_SIZE)}</span>
        <button type="button" disabled={(page + 1) * PAGE_SIZE >= mailPage.total} onClick={() => { setPage(page + 1); setSelectedId(null); }}>Далее</button>
      </div> : null}
    </section>

    <article className={`mail-reader ${selected ? "is-open" : ""}`} aria-label="Просмотр письма">
      {selected ? <><div className="mail-reader-toolbar"><button type="button" className="mail-reader-back" onClick={() => setSelectedId(null)}>
        <ArrowLeft className="size-4" />К письмам</button>
        {replyTarget?.sourceId ? <button type="button" className="mail-reply-button" onClick={() => openCompose(replyTarget)}>
          <Reply className="size-4" />Ответить</button> : null}</div>
        <div className="mail-reader-scroll"><span className="mail-eyebrow">{folder === "inbox" ? "Входящее письмо" : "Исходящее письмо"}</span>
          <h2>{selected.subject || "Без темы"}</h2>
          {!visibleThread || !visibleThread.items.some(item => item.id === selected.id && item.folder === folder) ? <><dl className="mail-reader-meta"><div><dt>От</dt><dd>{selected.fromAddress}</dd></div>
            <div><dt>Кому</dt><dd>{selected.recipientAddress}</dd></div>
            <div><dt>Дата</dt><dd>{new Date(selected.date).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</dd></div>
            {selected.status ? <div><dt>Статус</dt><dd>{statusLabel(selected.status)}</dd></div> : null}</dl>
          <div className="mail-reader-body">{selected.body || "Письмо без текстового содержимого."}</div></> : null}
          {threadError ? <div role="alert" className="mail-notice">{threadError} <button type="button" onClick={() => setThreadRetry(value => value + 1)}>Повторить</button></div> : null}
          {threadLoading ? <p role="status" className="mail-notice">Загружаем переписку...</p> : null}
          {visibleThread ? <div aria-label="Переписка">
            <p className="mail-eyebrow">Писем в переписке: {visibleThread.total}</p>
            {visibleThread.items.length < visibleThread.total ? <button type="button" className="mail-reply-bottom" disabled={threadLoading || Boolean(threadError)}
              onClick={() => { setThreadLoading(true); setThreadPage(value => value + 1); }}>Загрузить предыдущие письма</button> : null}
            {visibleThread.items.map(item => <section key={`${item.folder}:${item.id}`} data-mail-message-id={item.id}
              className="mail-thread-entry" aria-label={`Письмо от ${item.fromAddress}`}>
              <dl className="mail-reader-meta"><div><dt>От</dt><dd>{item.fromAddress}</dd></div>
                <div><dt>Кому</dt><dd>{item.recipientAddress}</dd></div>
                <div><dt>Дата</dt><dd>{dateLabel(item.date)}</dd></div>
                {item.status ? <div><dt>Статус</dt><dd>{statusLabel(item.status)}</dd></div> : null}</dl>
              {item.subject !== selected.subject ? <p className="mail-row-subject">{item.subject || "Без темы"}</p> : null}
              <div className="mail-reader-body">{item.bodyText || "Письмо без текстового содержимого."}</div>
              {item.folder === "inbox" && item.sourceId ? <button type="button" className="mail-reply-bottom"
                aria-label={`Ответить на письмо от ${item.fromAddress}`} onClick={() => openCompose(item)}><Reply className="size-4" />Ответить</button> : null}
            </section>)}
          </div> : null}
          {!visibleThread && replyTarget?.sourceId ? <button type="button" className="mail-reply-bottom" onClick={() => openCompose(replyTarget)}>
            <Reply className="size-4" />Ответить</button> : null}
        </div></> : <div className="mail-reader-placeholder"><Mail className="size-9" /><strong>Выберите письмо</strong>
        <span>Содержимое откроется здесь.</span></div>}
    </article>

    {composeOpen ? <div className="mail-compose-backdrop" onMouseDown={(event) => {
      if (!pending && event.target === event.currentTarget) setComposeOpen(false);
    }}><section className="mail-compose-dialog" role="dialog" aria-modal="true" aria-labelledby="mail-compose-heading" key={formKey}>
      <div className="mail-compose-heading"><div><span className="mail-eyebrow">Новое сообщение</span>
        <h2 id="mail-compose-heading">{replyTo ? "Ответить на письмо" : "Написать письмо"}</h2></div>
        <button type="button" disabled={pending} className="mail-icon-button" aria-label="Закрыть" onClick={() => setComposeOpen(false)}><X className="size-5" /></button></div>
      <form action={action} onSubmit={() => setSubmitAttempted(true)} className="mail-compose-form">
        <input type="hidden" name="sourceId" value={composeSource} />
        <input type="hidden" name="requestKey" value={requestKey} />
        <OrderPicker label="От" value={composeSource} onChange={setComposeSource} disabled={pending || Boolean(replyTo)}
          options={sources.map((item) => ({ value: item.id, label: `${item.organizationName} · ${item.address}` }))}
          placeholder="Выберите ящик" searchPlaceholder="Адрес или компания" required />
        <label>Кому<input name="toAddress" type="email" required disabled={pending} autoComplete="email" value={draft.toAddress}
          onChange={(event) => setDraft((value) => ({ ...value, toAddress: event.target.value }))} placeholder="name@example.com" /></label>
        <label>Тема<input name="subject" required disabled={pending} maxLength={500}
          value={draft.subject} onChange={(event) => setDraft((value) => ({ ...value, subject: event.target.value }))}
          placeholder="Тема письма" /></label>
        <label className="mail-compose-body-label">Текст<textarea name="bodyText" required disabled={pending} maxLength={100000}
          value={draft.bodyText} onChange={(event) => setDraft((value) => ({ ...value, bodyText: event.target.value }))}
          placeholder="Напишите сообщение..." /></label>
        {replyTo ? <input type="hidden" name="replyToMessageId" value={replyTo.id} /> : null}
        {!outboundReady ? <p className="mail-compose-warning">Исходящая почта ещё не настроена. Письмо пока нельзя отправить.</p> : null}
        {submitAttempted && result.message && !result.ok ? <p role="alert" className="mail-compose-warning">{result.message}</p> : null}
        <div className="mail-compose-actions"><button type="button" disabled={pending} onClick={() => setComposeOpen(false)}>Отмена</button>
          <button type="submit" disabled={pending || !outboundReady || !composeSource}><Send className="size-4" />
            {pending ? "Отправка..." : "Отправить"}</button></div>
      </form>
    </section></div> : null}
  </div>;
}
