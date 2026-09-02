import { z } from "zod";
import { documentCategories, documentCategoryLabels, type DocumentCategory } from "./types.ts";

export type DocumentArchiveSelection = {
  clientId: string | null;
  objectId: string | null;
  orderId: string | null;
  category: DocumentCategory | null;
};

export type DocumentArchiveCategoryNode = {
  category: DocumentCategory;
  label: string;
  documentCount: number;
};

export type DocumentArchiveOrderNode = {
  id: string;
  number: string;
  documentCount: number;
  categories: DocumentArchiveCategoryNode[];
};

export type DocumentArchiveObjectNode = {
  id: string;
  name: string;
  address: string;
  documentCount: number;
  orders: DocumentArchiveOrderNode[];
};

export type DocumentArchiveClientNode = {
  id: string;
  name: string;
  documentCount: number;
  objects: DocumentArchiveObjectNode[];
};

export type DocumentArchiveTree = {
  documentCount: number;
  clientCount: number;
  objectCount: number;
  orderCount: number;
  clients: DocumentArchiveClientNode[];
};

export type DocumentArchiveBranch = {
  clientId: string;
  clientName: string;
  objectId: string;
  objectName: string;
  objectAddress: string;
  orderId: string;
  orderNumber: string;
  category: DocumentCategory;
  documentCount: number;
};

const archiveSelectionSchema = z.object({
  clientId: z.string().uuid().nullable(),
  objectId: z.string().uuid().nullable(),
  orderId: z.string().uuid().nullable(),
  category: z.enum(documentCategories).nullable(),
}).superRefine((selection, context) => {
  if (selection.objectId && !selection.clientId) context.addIssue({ code: "custom", path: ["objectId"], message: "Object selection requires a client." });
  if (selection.orderId && (!selection.clientId || !selection.objectId)) context.addIssue({ code: "custom", path: ["orderId"], message: "Order selection requires a client and object." });
  if (selection.category && !selection.orderId) context.addIssue({ code: "custom", path: ["category"], message: "Category selection requires an order." });
});

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseDocumentArchiveSelection(searchParams: Record<string, string | string[] | undefined>): DocumentArchiveSelection {
  const candidate = {
    clientId: firstSearchValue(searchParams.client) ?? null,
    objectId: firstSearchValue(searchParams.object) ?? null,
    orderId: firstSearchValue(searchParams.order) ?? null,
    category: firstSearchValue(searchParams.category) ?? null,
  };
  const parsed = archiveSelectionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { clientId: null, objectId: null, orderId: null, category: null };
}

export function buildDocumentArchiveTree(branches: DocumentArchiveBranch[]): DocumentArchiveTree {
  const clients = new Map<string, DocumentArchiveClientNode>();
  let documentCount = 0;

  for (const branch of branches) {
    let client = clients.get(branch.clientId);
    if (!client) {
      client = { id: branch.clientId, name: branch.clientName, documentCount: 0, objects: [] };
      clients.set(branch.clientId, client);
    }

    let object = client.objects.find((candidate) => candidate.id === branch.objectId);
    if (!object) {
      object = { id: branch.objectId, name: branch.objectName, address: branch.objectAddress, documentCount: 0, orders: [] };
      client.objects.push(object);
    }

    let order = object.orders.find((candidate) => candidate.id === branch.orderId);
    if (!order) {
      order = { id: branch.orderId, number: branch.orderNumber, documentCount: 0, categories: [] };
      object.orders.push(order);
    }

    order.categories.push({ category: branch.category, label: documentCategoryLabels[branch.category], documentCount: branch.documentCount });
    order.documentCount += branch.documentCount;
    object.documentCount += branch.documentCount;
    client.documentCount += branch.documentCount;
    documentCount += branch.documentCount;
  }

  const clientNodes = [...clients.values()];
  return {
    documentCount,
    clientCount: clientNodes.length,
    objectCount: clientNodes.reduce((total, client) => total + client.objects.length, 0),
    orderCount: clientNodes.reduce((total, client) => total + client.objects.reduce((subtotal, object) => subtotal + object.orders.length, 0), 0),
    clients: clientNodes,
  };
}

export const emptyDocumentArchiveTree: DocumentArchiveTree = {
  documentCount: 0,
  clientCount: 0,
  objectCount: 0,
  orderCount: 0,
  clients: [],
};
