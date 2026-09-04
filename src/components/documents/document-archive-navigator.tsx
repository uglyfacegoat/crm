"use client";

import { Building2, ChevronDown, ChevronRight, ClipboardList, FileText, FolderRoot, MapPin } from "lucide-react";
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

type SelectionTarget = Partial<DocumentArchiveSelection>;

function selectionUrl(selection: DocumentArchiveSelection) {
  const params = new URLSearchParams();
  if (selection.clientId) params.set("client", selection.clientId);
  if (selection.objectId) params.set("object", selection.objectId);
  if (selection.orderId) params.set("order", selection.orderId);
  if (selection.category) params.set("category", selection.category);
  const query = params.toString();
  return query ? `/documents?${query}` : "/documents";
}

function Count({ value }: { value: number }) {
  return <span className="ml-auto shrink-0 rounded-full bg-white/[0.045] px-2 py-0.5 text-[9px] tabular-nums text-[#657078]">{value}</span>;
}

function ExpandButton({ expanded, label, onClick }: { expanded: boolean; label: string; onClick: () => void }) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return <button type="button" onClick={onClick} aria-label={`${expanded ? "Свернуть" : "Развернуть"} ${label}`} aria-expanded={expanded} className="focus-ring grid size-7 shrink-0 place-items-center rounded-[8px] text-[#58636a] hover:bg-white/[0.05] hover:text-white"><Icon className="size-3.5" /></button>;
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
    <div className={`flex items-center rounded-[9px] ${selected && !selection.category ? "bg-white/[0.045]" : ""}`}>
      <ExpandButton expanded={open} label={`заказ №${order.number}`} onClick={() => expansion.toggle(key)} />
      <button type="button" onClick={() => { expansion.open(key); navigate({ clientId, objectId, orderId: order.id, category: null }); }} className="focus-ring flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-[8px] pr-2 text-left text-[10px] text-[#7d888f] hover:text-white"><ClipboardList className="size-3.5 shrink-0 text-[#efb454]" /><span className="truncate">Заказ №{order.number}</span><Count value={order.documentCount} /></button>
    </div>
    {open ? <div className="ml-7 space-y-0.5 py-1">{order.categories.map((category) => <button type="button" key={category.category} onClick={() => navigate({ clientId, objectId, orderId: order.id, category: category.category })} className={`focus-ring flex min-h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[10px] ${selected && selection.category === category.category ? "bg-[var(--accent)]/[0.09] text-[var(--accent)]" : "text-[#727e85] hover:bg-white/[0.035] hover:text-white"}`}><FileText className="size-3 shrink-0" /><span className="truncate">{category.label}</span><Count value={category.documentCount} /></button>)}</div> : null}
  </div>;
}

function ArchiveObjectBranch({ clientId, object, selection, navigate, expansion }: BranchProps & { clientId: string; object: DocumentArchiveObjectNode }) {
  const key = `object:${object.id}`;
  const selected = selection.objectId === object.id;
  const open = expansion.isOpen(key, selected);
  return <div>
    <div className={`flex items-center rounded-[10px] ${selected && !selection.orderId ? "bg-white/[0.05]" : ""}`}>
      <ExpandButton expanded={open} label={object.name} onClick={() => expansion.toggle(key)} />
      <button type="button" onClick={() => { expansion.open(key); navigate({ clientId, objectId: object.id, orderId: null, category: null }); }} className="focus-ring flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-[9px] pr-2 text-left text-[10px] text-[#869198] hover:text-white"><MapPin className="size-3.5 shrink-0 text-[#b8f7e4]" /><span className="truncate">{object.name}</span><Count value={object.documentCount} /></button>
    </div>
    {open ? <div className="ml-3 border-l border-white/[0.05] pl-2">{object.orders.map((order) => <ArchiveOrderBranch key={order.id} clientId={clientId} objectId={object.id} order={order} selection={selection} navigate={navigate} expansion={expansion} />)}</div> : null}
  </div>;
}

function ArchiveClientBranch({ client, selection, navigate, expansion }: BranchProps & { client: DocumentArchiveClientNode }) {
  const key = `client:${client.id}`;
  const selected = selection.clientId === client.id;
  const open = expansion.isOpen(key, selected);
  return <div>
    <div className={`flex items-center rounded-[11px] ${selected && !selection.objectId ? "bg-white/[0.06]" : ""}`}>
      <ExpandButton expanded={open} label={client.name} onClick={() => expansion.toggle(key)} />
      <button type="button" onClick={() => { expansion.open(key); navigate({ clientId: client.id, objectId: null, orderId: null, category: null }); }} className="focus-ring flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[10px] pr-2 text-left text-[11px] text-[#a6afb4] hover:text-white"><Building2 className="size-3.5 shrink-0 text-[#b8f7e4]" /><span className="truncate">{client.name}</span><Count value={client.documentCount} /></button>
    </div>
    {open ? <div className="ml-3 border-l border-white/[0.055] pl-2">{client.objects.map((object) => <ArchiveObjectBranch key={object.id} clientId={client.id} object={object} selection={selection} navigate={navigate} expansion={expansion} />)}</div> : null}
  </div>;
}

function ArchiveDesktopTree({ archive, selection, navigate }: { archive: DocumentArchiveTree; selection: DocumentArchiveSelection; navigate: (target: SelectionTarget) => void }) {
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const expansion: TreeExpansion = {
    isOpen: (key, selected) => expanded.has(key) || selected,
    open: (key) => setExpanded((current) => new Set(current).add(key)),
    toggle: (key) => setExpanded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }),
  };

  return <nav aria-label="Дерево архива" className="hidden min-h-0 lg:block">
    <button type="button" onClick={() => navigate({ clientId: null, objectId: null, orderId: null, category: null })} className={`focus-ring flex min-h-11 w-full items-center gap-2.5 rounded-[12px] px-3 text-left text-xs ${!selection.clientId ? "bg-[var(--accent)]/[0.08] text-white" : "text-[#8a949a] hover:bg-white/[0.035]"}`}><FolderRoot className="size-4 text-[var(--accent)]" /><span className="min-w-0 flex-1 truncate">Весь архив</span><Count value={archive.documentCount} /></button>
    <div className="mt-2 space-y-0.5">{archive.clients.map((client) => <ArchiveClientBranch key={client.id} client={client} selection={selection} navigate={navigate} expansion={expansion} />)}</div>
  </nav>;
}

function MobileFolderButton({ icon: Icon, title, subtitle, count, onClick }: { icon: typeof FolderRoot; title: string; subtitle?: string; count: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="focus-ring flex w-[min(17rem,82vw)] shrink-0 items-center gap-3 rounded-[14px] border border-white/[0.065] bg-white/[0.025] p-3 text-left"><span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-white/[0.045] text-[var(--accent)]"><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-white">{title}</span>{subtitle ? <span className="mt-1 block truncate text-[9px] text-[#68737a]">{subtitle}</span> : null}</span><Count value={count} /></button>;
}

function ArchiveMobileNavigator({ archive, selection, navigate }: { archive: DocumentArchiveTree; selection: DocumentArchiveSelection; navigate: (target: SelectionTarget) => void }) {
  const client = archive.clients.find((candidate) => candidate.id === selection.clientId) ?? null;
  const object = client?.objects.find((candidate) => candidate.id === selection.objectId) ?? null;
  const order = object?.orders.find((candidate) => candidate.id === selection.orderId) ?? null;
  const category = order?.categories.find((candidate) => candidate.category === selection.category) ?? null;
  const selectedClientId = client?.id ?? null;
  const selectedObjectId = object?.id ?? null;
  const selectedOrderId = order?.id ?? null;
  let children: ReactNode;
  if (!client) children = archive.clients.map((item) => <MobileFolderButton key={item.id} icon={Building2} title={item.name} subtitle={`${item.objects.length} объектов`} count={item.documentCount} onClick={() => navigate({ clientId: item.id, objectId: null, orderId: null, category: null })} />);
  else if (!object) children = client.objects.map((item) => <MobileFolderButton key={item.id} icon={MapPin} title={item.name} subtitle={item.address} count={item.documentCount} onClick={() => navigate({ clientId: selectedClientId, objectId: item.id, orderId: null, category: null })} />);
  else if (!order) children = object.orders.map((item) => <MobileFolderButton key={item.id} icon={ClipboardList} title={`Заказ №${item.number}`} subtitle={`${item.categories.length} категорий`} count={item.documentCount} onClick={() => navigate({ clientId: selectedClientId, objectId: selectedObjectId, orderId: item.id, category: null })} />);
  else children = order.categories.map((item) => <MobileFolderButton key={item.category} icon={FileText} title={item.label} count={item.documentCount} onClick={() => navigate({ clientId: selectedClientId, objectId: selectedObjectId, orderId: selectedOrderId, category: item.category })} />);

  return <nav aria-label="Навигация по архиву" className="lg:hidden">
    <div className="scrollbar-hidden flex items-center gap-1 overflow-x-auto pb-2 text-[9px] text-[#68737a]"><button type="button" onClick={() => navigate({ clientId: null, objectId: null, orderId: null, category: null })} className="focus-ring shrink-0 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] hover:text-white">Архив</button>{client ? <><ChevronRight className="size-3 shrink-0" /><button type="button" onClick={() => navigate({ clientId: selectedClientId, objectId: null, orderId: null, category: null })} className="focus-ring max-w-40 shrink-0 truncate rounded-lg px-2 py-1.5 hover:bg-white/[0.04] hover:text-white">{client.name}</button></> : null}{object ? <><ChevronRight className="size-3 shrink-0" /><button type="button" onClick={() => navigate({ clientId: selectedClientId, objectId: selectedObjectId, orderId: null, category: null })} className="focus-ring max-w-36 shrink-0 truncate rounded-lg px-2 py-1.5 hover:bg-white/[0.04] hover:text-white">{object.name}</button></> : null}{order ? <><ChevronRight className="size-3 shrink-0" /><button type="button" onClick={() => navigate({ clientId: selectedClientId, objectId: selectedObjectId, orderId: selectedOrderId, category: null })} className="focus-ring shrink-0 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] hover:text-white">№{order.number}</button></> : null}{category ? <><ChevronRight className="size-3 shrink-0" /><span className="shrink-0 px-2 py-1.5 text-[var(--accent)]">{category.label}</span></> : null}</div>
    {!category ? <div className="scrollbar-hidden flex gap-2 overflow-x-auto pb-1">{children}</div> : null}
  </nav>;
}

export function DocumentArchiveNavigator({ archive, selection }: { archive: DocumentArchiveTree; selection: DocumentArchiveSelection }) {
  const router = useRouter();
  const navigate = (target: SelectionTarget) => {
    const next: DocumentArchiveSelection = {
      clientId: target.clientId === undefined ? selection.clientId : target.clientId,
      objectId: target.objectId === undefined ? selection.objectId : target.objectId,
      orderId: target.orderId === undefined ? selection.orderId : target.orderId,
      category: target.category === undefined ? selection.category : target.category,
    };
    router.push(selectionUrl(next), { scroll: false });
  };
  return <><ArchiveDesktopTree archive={archive} selection={selection} navigate={navigate} /><ArchiveMobileNavigator archive={archive} selection={selection} navigate={navigate} /></>;
}

export function getArchiveSelectionTitle(archive: DocumentArchiveTree, selection: DocumentArchiveSelection) {
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
