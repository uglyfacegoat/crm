import { z } from "zod";

export const ORDER_PICKER_PAGE_SIZE = 20;
export const orderPickerQuerySchema = z.object({
  type: z.enum(["clients", "objects", "contacts", "masters"]),
  q: z.string().trim().max(100).default(""),
  clientId: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if ((value.type === "objects" || value.type === "contacts") && !value.clientId) {
    context.addIssue({ code: "custom", path: ["clientId"], message: "Выберите клиента." });
  }
});

export type OrderPickerQuery = z.infer<typeof orderPickerQuerySchema>;
export type OrderPickerItem = {
  id: string;
  name: string;
  detail?: string;
  clientId?: string;
  isPrimary?: boolean;
};
export type OrderPickerResult = { items: OrderPickerItem[]; hasMore: boolean };
