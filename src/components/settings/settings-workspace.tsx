"use client";

import { Check, DatabaseBackup, Download, KeyRound, PlugZap, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";

const settingTabs = ["Основные", "Пользователи", "Роли и права", "Интеграции", "Уведомления", "Шаблоны", "Безопасность", "Система"];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className={`focus-ring relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-[var(--accent)]" : "bg-white/[0.1]"}`}><span className={`absolute top-1 size-4 rounded-full transition-transform ${checked ? "translate-x-6 bg-[#111509]" : "translate-x-1 bg-[#8b9499]"}`} /></button>;
}

export function SettingsWorkspace() {
  const [activeTab, setActiveTab] = useState("Основные");
  const [saved, setSaved] = useState(false);
  const [company, setCompany] = useState({ name: "ООО «ДезСервис»", taxId: "7723456789", phone: "+7 (495) 123-45-67", email: "info@dezservice.ru" });
  const [toggles, setToggles] = useState({ autoAssign: true, confirmation: true, autoTasks: true, overdue: true, offHours: false, backups: true });

  function saveDemo() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2400);
  }

  return (
    <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06] pb-px">{settingTabs.map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`focus-ring h-11 shrink-0 border-b-2 px-3 text-xs transition-colors ${activeTab === tab ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[#788288] hover:text-white"}`}>{tab}</button>)}</div>
      {activeTab !== "Основные" ? <section className="surface-panel mt-5 grid min-h-72 place-items-center p-8 text-center"><div><PlugZap className="mx-auto size-8 text-[#687279]" /><h2 className="mt-4 font-display text-lg font-semibold text-white">Раздел «{activeTab}» подготовлен</h2><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[#737d83]">Интерфейс появится после серверной авторизации и модели прав. Мы не сохраняем чувствительные настройки только в браузере.</p></div></section> : <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem]">
        <div className="grid content-start gap-4">
          <section className="surface-panel p-5"><h2 className="font-display text-base font-semibold text-white">Компания</h2><p className="mt-1 text-xs text-[#6e787e]">Основные реквизиты рабочей организации</p><div className="mt-5 grid gap-4">{([{ key: "name", label: "Название компании" }, { key: "taxId", label: "ИНН" }, { key: "phone", label: "Основной телефон" }, { key: "email", label: "Email для уведомлений" }] as const).map((field) => <label key={field.key} className="grid gap-2 text-[10px] text-[#7b858b]"><span>{field.label}</span><input value={company[field.key]} onChange={(event) => setCompany((current) => ({ ...current, [field.key]: event.target.value }))} className="focus-ring h-11 rounded-[11px] border border-white/[0.07] bg-black/10 px-3 text-xs text-white outline-none" /></label>)}</div><button onClick={saveDemo} className="focus-ring mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-[11px] border border-[var(--accent)]/20 bg-[var(--accent)]/[0.07] text-xs font-medium text-[var(--accent)]">{saved ? <><Check className="size-4" />Сохранено в демо-сеансе</> : "Сохранить изменения"}</button></section>
          <section className="surface-panel p-5"><div className="flex items-center gap-3"><DatabaseBackup className="size-5 text-[var(--accent)]" /><div><h2 className="font-display text-base font-semibold text-white">Резервное копирование</h2><p className="mt-1 text-xs text-[#6e787e]">Политика сохранности данных</p></div></div><div className="mt-5 flex items-center gap-3"><div className="min-w-0 flex-1"><p className="text-xs text-white">Автоматические резервные копии</p><p className="mt-1 text-[10px] text-[#687279]">Ежедневно в 03:00 после подключения хранилища</p></div><Toggle label="Автоматические резервные копии" checked={toggles.backups} onChange={() => setToggles((current) => ({ ...current, backups: !current.backups }))} /></div><p className="mt-5 rounded-[11px] bg-white/[0.025] p-3 text-[10px] leading-5 text-[#707a80]">Сейчас это настройка интерфейса. Реальный backup и обязательная проверка восстановления включены в приоритет 1.</p></section>
        </div>

        <div className="grid content-start gap-4">
          <section className="surface-panel p-5"><h2 className="font-display text-base font-semibold text-white">Региональные настройки</h2><p className="mt-1 text-xs text-[#6e787e]">Форматы дат, времени и денег</p><div className="mt-5 grid gap-4">{[["Часовой пояс", "(UTC+03:00) Москва"], ["Формат даты", "25.08.2026"], ["Формат времени", "24 часа (14:30)"], ["Валюта", "Российский рубль (₽)"]].map(([label, value]) => <label key={label} className="grid gap-2 text-[10px] text-[#7b858b]"><span>{label}</span><span className="flex h-11 items-center rounded-[11px] border border-white/[0.07] bg-black/10 px-3 text-xs text-[#cbd0cd]">{value}</span></label>)}</div></section>
          <section className="surface-panel p-5"><h2 className="font-display text-base font-semibold text-white">Рабочие настройки</h2><div className="mt-4 divide-y divide-white/[0.055]">{[
            ["autoAssign", "Автоматическое назначение мастеров", "По региону, специализации и текущей загрузке"],
            ["confirmation", "Подтверждение выезда мастером", "Требовать подтверждение в мобильной версии"],
            ["autoTasks", "Автоматическое создание задач", "Создавать задачи вместе с заказом и серией выездов"],
            ["overdue", "Уведомления о просрочке", "Сообщать ответственным о нарушенном сроке"],
            ["offHours", "Уведомления в нерабочее время", "Только для критичных событий"],
          ].map(([key, title, description]) => <div key={key} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="text-xs text-white">{title}</p><p className="mt-1 text-[10px] leading-4 text-[#687279]">{description}</p></div><Toggle label={title} checked={toggles[key as keyof typeof toggles]} onChange={() => setToggles((current) => ({ ...current, [key]: !current[key as keyof typeof toggles] }))} /></div>)}</div></section>
        </div>

        <aside className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <section className="surface-panel p-5"><div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-full bg-[var(--accent)] font-display font-semibold text-[#111509]">ИП</span><div><p className="text-sm font-semibold text-white">Иван Петров</p><p className="mt-1 text-[10px] text-[#747e84]">Администратор</p></div></div><p className="mt-5 text-xs text-[#9aa3a8]">ivan.petrov@dezservice.ru</p><p className="mt-2 text-xs text-[#9aa3a8]">+7 (495) 123-45-67</p><button disabled title="Профиль будет редактироваться после подключения пользователей" className="soft-button mt-5 h-10 w-full cursor-not-allowed rounded-[11px] text-xs text-[#717b81]">Редактировать профиль</button></section>
          <section className="surface-panel p-5"><h2 className="font-display text-base font-semibold text-white">Безопасность аккаунта</h2><div className="mt-4 space-y-2">{[[KeyRound,"Смена пароля","Не настроено"],[ShieldCheck,"Двухфакторная аутентификация","Запланировано"],[UserRound,"Активные сессии","1 демо-сеанс"]].map(([Icon,title,meta]) => { const ItemIcon = Icon as typeof KeyRound; return <div key={String(title)} className="flex items-center gap-3 rounded-[11px] bg-white/[0.025] p-3"><ItemIcon className="size-4 text-[#7a848a]" /><div><p className="text-xs text-white">{String(title)}</p><p className="mt-1 text-[9px] text-[#69737a]">{String(meta)}</p></div></div>; })}</div></section>
          <section className="surface-panel p-5"><h2 className="font-display text-base font-semibold text-white">Экспорт данных</h2><p className="mt-2 text-[10px] leading-5 text-[#6e787e]">Экспорт будет выполняться сервером с проверкой прав и журналом операций.</p><button disabled className="soft-button mt-4 flex h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded-[11px] text-xs text-[#717b81]"><Download className="size-4" />Подготовить экспорт</button></section>
        </aside>
      </div>}
    </div>
  );
}
