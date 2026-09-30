"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { completeOrderLinksAction, type OrderMutationState } from "@/app/(workspace)/orders/actions";
import { OrderPicker } from "@/components/orders/order-form-parts";
import type { OrderCreationOptions, OrderDetail } from "@/server/orders/types";

const initialState: OrderMutationState = { status: "idle", message: null, fieldErrors: {} };

export function OrderLinksCompletion({ order, options }: { order: OrderDetail; options: OrderCreationOptions }) {
  const [state, action, pending] = useActionState(completeOrderLinksAction, initialState);
  const [objectId, setObjectId] = useState(order.objectId ?? "");
  const [contactId, setContactId] = useState(order.contactId ?? "");
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  const objects = options.objects.filter((item) => item.clientId === order.clientId);
  const contacts = options.contacts.filter((item) => item.clientId === order.clientId);
  const objectOptions = [
    { value: "", label: "Пока не выбран" },
    ...objects.map((object) => ({ value: object.id, label: object.name, detail: object.address })),
  ];
  const contactOptions = [
    { value: "", label: "Пока не выбрано" },
    ...contacts.map((contact) => ({ value: contact.id, label: contact.name, detail: contact.phone })),
  ];
  if (order.objectId && !objects.some((object) => object.id === order.objectId)) {
    objectOptions.push({ value: order.objectId, label: order.object, detail: order.address });
  }
  if (order.contactId && !contacts.some((contact) => contact.id === order.contactId)) {
    contactOptions.push({ value: order.contactId, label: order.contactName, detail: order.contactPhone });
  }
  return <section className="surface-panel p-5 sm:p-6">
    <h2 className="text-base font-semibold text-[var(--text)]">Дополнить заказ</h2>
    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Объект нужен перед назначением выезда. Контактное лицо можно добавить позже.</p>
    <form action={action} className="mt-4 grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="orderId" value={order.id} />
      <input type="hidden" name="expectedVersion" value={order.version} />
      <input type="hidden" name="objectId" value={objectId} />
      <input type="hidden" name="contactId" value={contactId} />
      <OrderPicker label="Объект" value={objectId} onChange={setObjectId} options={objectOptions} placeholder="Пока не выбран" remote={{ type: "objects", clientId: order.clientId }} searchPlaceholder="Название или адрес" />
      <OrderPicker label="Контактное лицо" value={contactId} onChange={setContactId} options={contactOptions} placeholder="Пока не выбрано" remote={{ type: "contacts", clientId: order.clientId }} searchPlaceholder="Имя или телефон" />
      {state.message ? <p role="status" className="text-xs text-[var(--text)] sm:col-span-2">{state.message}</p> : null}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button type="submit" disabled={pending} className="focus-ring min-h-11 rounded-xl bg-[var(--accent)] px-5 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-50">Сохранить связи</button><Link href={`/clients/${order.clientId}`} className="text-xs text-[var(--accent)] underline underline-offset-4">Создать объект или контакт у клиента</Link></div>
    </form>
  </section>;
}
