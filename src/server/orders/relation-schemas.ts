import { z } from "zod";

export const linkOrderSchema = z.object({
  orderId: z.string().uuid(),
  relatedOrderId: z.string().uuid(),
}).refine((value) => value.orderId !== value.relatedOrderId, {
  path: ["relatedOrderId"],
  message: "Заказ нельзя связать с самим собой",
});

export type LinkOrderInput = z.infer<typeof linkOrderSchema>;
