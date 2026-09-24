"use client";

import { Building2, ChevronDown, ChevronRight, ClipboardList, FileText, Folder, FolderRoot, MapPin, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import type {
  DocumentArchiveClientNode,
  DocumentArchiveObjectNode,
  DocumentArchiveOrderNode,
  DocumentArchiveSelection,
  DocumentArchiveTree,
} from "@/server/documents/archive";
import type { DocumentFolder } from "@/server/documents/types";

type SelectionTarget = Partial<DocumentArchiveSelection>;

function selectionUrl(selection: DocumentArchiveSelection) {
  const params = new URLSearchParams();
  if (selection.clientId) params.set("client", selection.clientId);
  if (selection.objectId) params.set("object", selection.objectId);
  if (selection.orderId) params.set("order", selection.orderId);
  if (selection.category) params.set("category", selection.category);
  if (selection.folderId) params.set("folder", selection.folderId);
  if (selection.favoriteOnly) params.set("favorite", "1");
  const query = params.toString();
  return query ? `/documents?${query}` : "/documents";
}

function Count({ value }: { value: number }) {
  return <span className="ml-auto shrink-0 rounded-full bg-[var(--surface-soft)] px-2 py-0.5 text-[9px] tabular-nums text-[var(--muted)]">{value}</span>;
}

function ExpandButton({ expanded, label, onClick }: { expanded: boolean; label: string; onClick: () => void }) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return <button type="button" onClick={onClick} aria-label={`${expanded ? "Свернуть" : "Развернуть"} ${label}`} aria-expanded={expanded} className="focus-ring grid size-7 shrink-0 place-items-center rounded-[8px] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"><Icon className="size-3.5" /></button>;
}

type TreeExpansion = {
  isOpen: (key: string, selected: boolean) => boolean;
  open: (key: string) => void;
  toggle: (key: string) => void;
};

type BranchProps = {
  selection: DocumentArchiveSelection;
  navigate: (target: SelectionTarget) => void;
  expansion: TreeExpansion;
};

function ArchiveOrderBranch({ clientId, objectId, order, selection, navigate, expansion }: BranchProps & { clientId: string; objectId: string; order: DocumentArchiveOrderNode }) {
  const key = `order:${order.id}`;
  const selected = selection.orderId === order.id;
  const open = expansion.isOpen(key, selected);
  return <div>
    <div className={`flex items-center rounded-[9px] ${selected && !selection.category ? "bg-[var(--surface-soft)]" : ""}`}>
      <ExpandButton expanded={open} label={`заказ №${order.number}`} onClick={() => expansion.toggle(key)} />
      <button type="button" onClick={() => { expansion.open(key); navigate({ clientId, objectId, orderId: order.id, category: null }); }} className="focus-ring flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-[8px] pr-2 text-left text-[10px] text-[var(--text-secondary)] hover:text-[var(--text)]"><ClipboardList className="size-3.5 shrink-0 text-[var(--warning)]" /><span className="truncate">Заказ №{order.number}</span><Count value={order.documentCount} /></button>
    </div>
    {open ? <div className="ml-7 space-y-0.5 py-1">{order.categories.map((category) => <button type="button" key={category.category} onClick={() => navigate({ clientId, objectId, orderId: order.id, category: category.category })} className={`focus-ring flex min-h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[10px] ${selected && selection.category === category.category ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}><FileText className="size-3 shrink-0" /><span className="truncate">{category.label}</span><Count value={category.documentCount} /></button>)}</div> : null}
  </div>;
}

function ArchiveObjectBranch({ clientId, object, selection, navigate, expansion }: BranchProps & { clientId: string; object: DocumentArchiveObjectNode }) {
  const key = `object:${object.id}`;
  const selected = selection.objectId === object.id;
  const open = expansion.isOpen(key, selected);
  return <div>
    <div className={`flex items-center rounded-[10px] ${selected && !selection.orderId ? "bg-[var(--surface-soft)]" : ""}`}>
      <ExpandButton expanded={open} label={object.name} onClick={() => expansion.toggle(key)} />
      <button type="button" onClick={() => { expansion.open(key); navigate({ clientId, objectId: object.id, orderId: null, category: null }); }} className="focus-ring flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-[9px] pr-2 text-left text-[10px] text-[var(--text-secondary)] hover:text-[var(--text)]"><MapPin className="size-3.5 shrink-0 text-[var(--support)]" /><span className="truncate">{object.name}</span><Count value={object.documentCount} /></button>
    </div>
    {open ? <div className="ml-3 border-l border-[var(--line)] pl-2">{object.orders.map((order) => <ArchiveOrderBranch key={order.id} clientId={clientId} objectId={object.id} order={order} selection={selection} navigate={navigate} expansion={expansion} />)}</div> : null}
  </div>;
}

function ArchiveClientBranch({ client, selection, navigate, expansion }: BranchProps & { client: DocumentArchiveClientNode }) {
  const key = `client:${client.id}`;
  const selected = selection.clientId === client.id;
  const open = expansion.isOpen(key, selected);
  return <div>
    <div className={`flex items-center rounded-[11px] ${selected && !selection.objectId ? "bg-[var(--surface-soft)]" : ""}`}>
      <ExpandButton expanded={open} label={client.name} onClick={() => expansion.toggle(key)} />
      <button type="button" onClick={() => { expansion.open(key); navigate({ clientId: client.id, objectId: null, orderId: null, category: null }); }} className="focus-ring flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[10px] pr-2 text-left text-[11px] text-[var(--text-secondary)] hover:text-[var(--text)]"><Building2 className="size-3.5 shrink-0 text-[var(--accent)]" /><span className="truncate">{client.name}</span><Count value={client.documentCount} /></button>
    </div>
    {open ? <div className="ml-3 border-l border-[var(--line)] pl-2">{client.objects.map((object) => <ArchiveObjectBranch key={object.id} clientId={client.id} object={object} selection={selection} navigate={navigate} expansion={expansion} />)}</div> : null}
  </div>;
}

function FolderBranch({ folder, folders, selection, navigate }: { folder: DocumentFolder; folders: DocumentFolder[]; selection: DocumentArchiveSelection; navigate: (target: SelectionTarget) => void }) {
  const children = folders.filter((candidate) => candidate.parentFolderId === folder.id);
  return <div className="ml-2 border-l border-[var(--line)] pl-2"><button type="button" onClick={() => navigate({ clientId: null, objectId: null, orderId: null, category: null, folderId: folder.id, favoriteOnly: false })} className={`focus-ring flex min-h-9 w-full items-center gap-2 rounded-[9px] px-2 text-left text-[10px] ${selection.folderId === folder.id ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"}`}><Folder className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{folder.name}</span><Count value={folder.documentCount} /></button>{children.map((child) => <FolderBranch key={child.id} folder={child} folders={folders} selection={selection} navigate={navigate} />)}</div>;
}

function ArchiveDesktopTree({ archive, folders, selection, navigate }: { archive: DocumentArchiveTree; folders: DocumentFolder[]; selection: DocumentArchiveSelection; navigate: (target: SelectionTarget) => void }) {
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const expansion: TreeExpansion = {
    isOpen: (key, selected) => expanded.has(key) || selected,
    open: (key) => setExpanded((current) => new Set(current).add(key)),
    toggle: (key) => setExpanded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }),
  };

  return <nav aria-label="Дерево архива" className="hidden min-h-0 lg:block">
    <button type="button" onClick={() => navigate({ clientId: null, objectId: null, orderId: null, category: null, folderId: null, favoriteOnly: false })} className={`focus-ring flex min-h-11 w-full items-center gap-2.5 rounded-[12px] px-3 text-left text-xs ${!selection.clientId && !selection.folderId && !selection.favoriteOnly ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"}`}><FolderRoot className="size-4 text-[var(--accent)]" /><span className="min-w-0 flex-1 truncate">Весь архив</span><Count value={archive.documentCount} /></button>
    <button type="button" onClick={() => navigate({ clientId: null, objectId: null, orderId: null, category: null, folderId: null, favoriteOnly: true })} className={`focus-ring mt-1 flex min-h-10 w-full items-center gap-2.5 rounded-[11px] px-3 text-left text-[11px] ${selection.favoriteOnly ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"}`}><Star className={`size-3.5 ${selection.favoriteOnly ? "fill-current" : ""}`} /><span className="flex-1">Избранное</span></button>
    {folders.length ? <div className="mt-3 border-t border-[var(--line)] pt-3"><p className="mb-2 px-3 text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">Пользовательские папки</p>{folders.filter((folder) => folder.parentFolderId === null).map((folder) => <FolderBranch key={folder.id} folder={folder} folders={folders} selection={selection} navigate={navigate} />)}</div> : null}
    <p className="mb-1 mt-3 border-t border-[var(--line)] px-3 pt-3 text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">По связям</p>
    <div className="mt-2 space-y-0.5">{archive.clients.map((client) => <ArchiveClientBranch key={client.id} client={client} selection={selection} navigate={navigate} expansion={expansion} />)}</div>
  </nav>;
}

function MobileFolderButton({ icon: Icon, title, subtitle, count, onClick }: { icon: typeof FolderRoot; title: string; subtitle?: string; count?: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="focus-ring flex w-[min(17rem,82vw)] shrink-0 items-center gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-left hover:bg-[var(--surface-soft)]"><span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-[var(--surface-soft)] text-[var(--accent)]"><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[var(--text)]">{title}</span>{subtitle ? <span className="mt-1 block truncate text-[9px] text-[var(--muted)]">{subtitle}</span> : null}</span>{count === undefined ? null : <Count value={count} />}</button>;
}

function ArchiveMobileNavigator({ archive, folders, selection, navigate }: { archive: DocumentArchiveTree; folders: DocumentFolder[]; selection: DocumentArchiveSelection; navigate: (target: SelectionTarget) => void }) {
  const client = archive.clients.find((candidate) => candidate.id === selection.clientId) ?? null;
  const object = client?.objects.find((candidate) => candidate.id === selection.objectId) ?? null;
  const order = object?.orders.find((candidate) => candidate.id === selection.orderId) ?? null;
  const category = order?.categories.find((candidate) => candidate.category === selection.category) ?? null;
  const selectedClientId = client?.id ?? null;
  const selectedObjectId = object?.id ?? null;
  const selectedOrderId = order?.id ?? null;
  const selectedFolder = folders.find((candidate) => candidate.id === selection.folderId) ?? null;
  let children: ReactNode;
  if (!client) children = <><MobileFolderButton icon={Star} title="Избранное" onClick={() => navigate({ clientId: null, objectId: null, orderId: null, category: null, folderId: null, favoriteOnly: true })} />{folders.filter((folder) => folder.parentFolderId === null).map((folder) => <MobileFolderButton key={folder.id} icon={Folder} title={folder.name} subtitle="Пользовательская папка" count={folder.documentCount} onClick={() => navigate({ clientId: null, objectId: null, orderId: null, category: null, folderId: folder.id, favoriteOnly: false })} />)}{archive.clients.map((item) => <MobileFolderButton key={item.id} icon={Building2} title={item.name} subtitle={`${item.objects.length} объектов`} count={item.documentCount} onClick={() => navigate({ clientId: item.id, objectId: null, orderId: null, category: null })} />)}</>;
  else if (!object) children = client.objects.map((item) => <MobileFolderButton key={item.id} icon={MapPin} title={item.name} subtitle={item.address} count={item.documentCount} onClick={() => navigate({ clientId: selectedClientId, objectId: item.id, orderId: null, category: null })} />);
  else if (!order) children = object.orders.map((item) => <MobileFolderButton key={item.id} icon={ClipboardList} title={`Заказ №${item.number}`} subtitle={`${item.categories.length} категорий`} count={item.documentCount} onClick={() => navigate({ clientId: selectedClientId, objectId: selectedObjectId, orderId: item.id, category: null })} />);
  else children = order.categories.map((item) => <MobileFolderButton key={item.category} icon={FileText} title={item.label} count={item.documentCount} onClick={() => navigate({ clientId: selectedClientId, objectId: selectedObjectId, orderId: selectedOrderId, category: item.category })} />);

  return <nav aria-label="Навигация по архиву" className="lg:hidden">
    <div className="scrollbar-hidden flex items-center gap-1 overflow-x-auto pb-2 text-[9px] text-[var(--muted)]"><button type="button" onClick={() => navigate({ clientId: null, objectId: null, orderId: null, category: null, folderId: null, favoriteOnly: false })} className="focus-ring shrink-0 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">Архив</button>{selection.favoriteOnly ? <><ChevronRight className="size-3 shrink-0" /><span className="shrink-0 px-2 py-1.5 text-[var(--accent)]">Избранное</span></> : null}{selectedFolder ? <><ChevronRight className="size-3 shrink-0" /><span className="max-w-40 shrink-0 truncate px-2 py-1.5 text-[var(--accent)]">{selectedFolder.name}</span></> : null}{client ? <><ChevronRight className="size-3 shrink-0" /><button type="button" onClick={() => navigate({ clientId: selectedClientId, objectId: null, orderId: null, category: null })} className="focus-ring max-w-40 shrink-0 truncate rounded-lg px-2 py-1.5 hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">{client.name}</button></> : null}{object ? <><ChevronRight className="size-3 shrink-0" /><button type="button" onClick={() => navigate({ clientId: selectedClientId, objectId: selectedObjectId, orderId: null, category: null })} className="focus-ring max-w-36 shrink-0 truncate rounded-lg px-2 py-1.5 hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">{object.name}</button></> : null}{order ? <><ChevronRight className="size-3 shrink-0" /><button type="button" onClick={() => navigate({ clientId: selectedClientId, objectId: selectedObjectId, orderId: selectedOrderId, category: null })} className="focus-ring shrink-0 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">№{order.number}</button></> : null}{category ? <><ChevronRight className="size-3 shrink-0" /><span className="shrink-0 px-2 py-1.5 text-[var(--accent)]">{category.label}</span></> : null}</div>
    {!category && !selection.favoriteOnly && !selectedFolder ? <div className="scrollbar-hidden flex gap-2 overflow-x-auto pb-1">{children}</div> : null}
  </nav>;
}

export function DocumentArchiveNavigator({ archive, folders, selection }: { archive: DocumentArchiveTree; folders: DocumentFolder[]; selection: DocumentArchiveSelection }) {
  const router = useRouter();
  const navigate = (target: SelectionTarget) => {
    const selectsBusinessBranch = target.clientId !== undefined || target.objectId !== undefined || target.orderId !== undefined || target.category !== undefined;
    const next: DocumentArchiveSelection = {
      clientId: target.clientId === undefined ? selection.clientId : target.clientId,
      objectId: target.objectId === undefined ? selection.objectId : target.objectId,
      orderId: target.orderId === undefined ? selection.orderId : target.orderId,
      category: target.category === undefined ? selection.category : target.category,
      folderId: target.folderId === undefined ? (selectsBusinessBranch ? null : selection.folderId) : target.folderId,
      favoriteOnly: target.favoriteOnly === undefined ? (selectsBusinessBranch ? false : selection.favoriteOnly) : target.favoriteOnly,
    };
    router.push(selectionUrl(next), { scroll: false });
  };
  return <><ArchiveDesktopTree archive={archive} folders={folders} selection={selection} navigate={navigate} /><ArchiveMobileNavigator archive={archive} folders={folders} selection={selection} navigate={navigate} /></>;
}

export function getArchiveSelectionTitle(archive: DocumentArchiveTree, selection: DocumentArchiveSelection) {
  if (selection.favoriteOnly) return "Избранные документы";
  if (selection.folderId) return "Пользовательская папка";
  const client: DocumentArchiveClientNode | undefined = archive.clients.find((candidate) => candidate.id === selection.clientId);
  const object: DocumentArchiveObjectNode | undefined = client?.objects.find((candidate) => candidate.id === selection.objectId);
  const order: DocumentArchiveOrderNode | undefined = object?.orders.find((candidate) => candidate.id === selection.orderId);
  const category = order?.categories.find((candidate) => candidate.category === selection.category);
  if (category) return `${category.label} · заказ №${order?.number}`;
  if (order) return `Заказ №${order.number}`;
  if (object) return object.name;
  if (client) return client.name;
  return "Последние документы";
}
