export type OrderStatus =
  | "Новый"
  | "В работе"
  | "На согласовании"
  | "Запланирован"
  | "Выполнен"
  | "Просрочен";

export type Order = {
  id: string;
  number: string;
  client: string;
  object: string;
  address: string;
  service: string;
  amount: number;
  createdAt: string;
  status: OrderStatus;
  master: string | null;
  masterPhone: string | null;
  masterPayment: number | null;
  additionalExpenses: number;
  contact: string;
  contactPhone: string;
};

export type Visit = {
  id: string;
  orderId: string;
  time: string;
  client: string;
  address: string;
  master: string;
  status: "Подтверждён" | "Запланирован" | "В работе";
  color: "lime" | "violet" | "mint" | "yellow";
};

export type WorkTask = {
  id: string;
  title: string;
  meta: string;
  due: string;
  urgent?: boolean;
};

export type Client = {
  id: string;
  name: string;
  kind: "Юр. лицо" | "Физ. лицо";
  taxId: string | null;
  phone: string;
  email: string;
  objects: number;
  orders: number;
  contact: string;
};

export const orders: Order[] = [
  {
    id: "ord-1248",
    number: "1248",
    client: "ООО «Домжилсервис»",
    object: "Жилой дом на Ленина",
    address: "Москва, ул. Ленина, 15",
    service: "Дезинсекция",
    amount: 25000,
    createdAt: "2026-08-25",
    status: "В работе",
    master: "Алексей Смирнов",
    masterPhone: "+7 495 123-45-67",
    masterPayment: 4000,
    additionalExpenses: 1800,
    contact: "Иванова Ирина",
    contactPhone: "+7 916 421-18-09",
  },
  {
    id: "ord-1247",
    number: "1247",
    client: "ТСЖ «Пруды»",
    object: "Корпус №2",
    address: "Москва, ул. Озёрная, 8",
    service: "Дератизация",
    amount: 18500,
    createdAt: "2026-08-25",
    status: "На согласовании",
    master: "Дмитрий Кузнецов",
    masterPhone: "+7 903 555-66-77",
    masterPayment: 3500,
    additionalExpenses: 1200,
    contact: "Антон Рыжов",
    contactPhone: "+7 926 901-04-22",
  },
  {
    id: "ord-1246",
    number: "1246",
    client: "ООО «Вектор»",
    object: "Склад №1",
    address: "Химки, ул. Мира, 21",
    service: "Обработка территории",
    amount: 42000,
    createdAt: "2026-08-24",
    status: "Выполнен",
    master: "Сергей Волков",
    masterPhone: "+7 916 222-33-44",
    masterPayment: 6000,
    additionalExpenses: 3200,
    contact: "Мария Белова",
    contactPhone: "+7 915 302-45-70",
  },
  {
    id: "ord-1245",
    number: "1245",
    client: "ИП Иванов И.И.",
    object: "Магазин на Садовой",
    address: "Москва, ул. Садовая, 3",
    service: "Дезинфекция",
    amount: 12000,
    createdAt: "2026-08-24",
    status: "Просрочен",
    master: null,
    masterPhone: null,
    masterPayment: null,
    additionalExpenses: 0,
    contact: "Иван Иванов",
    contactPhone: "+7 901 111-22-33",
  },
  {
    id: "ord-1244",
    number: "1244",
    client: "ООО «Орион»",
    object: "Бизнес-центр",
    address: "Москва, ул. Тверская, 7",
    service: "Комплексная обработка",
    amount: 36000,
    createdAt: "2026-08-23",
    status: "Запланирован",
    master: "Мария Смирнова",
    masterPhone: "+7 925 444-55-66",
    masterPayment: 5200,
    additionalExpenses: 2400,
    contact: "Олег Ким",
    contactPhone: "+7 985 777-80-18",
  },
  {
    id: "ord-1243",
    number: "1243",
    client: "ООО «Альфа»",
    object: "Офис",
    address: "Москва, ул. Лесная, 9",
    service: "Дезинсекция",
    amount: 20000,
    createdAt: "2026-08-22",
    status: "Новый",
    master: null,
    masterPhone: null,
    masterPayment: null,
    additionalExpenses: 0,
    contact: "Елена Громова",
    contactPhone: "+7 495 682-13-02",
  },
];

export const visits: Visit[] = [
  { id: "visit-1", orderId: "ord-1248", time: "09:00", client: "ООО «Домжилсервис»", address: "ул. Ленина, 15", master: "Алексей Смирнов", status: "Запланирован", color: "yellow" },
  { id: "visit-2", orderId: "ord-1247", time: "11:30", client: "ТСЖ «Пруды»", address: "ул. Озёрная, 8", master: "Дмитрий Кузнецов", status: "Подтверждён", color: "mint" },
  { id: "visit-3", orderId: "ord-1246", time: "13:00", client: "ООО «Вектор»", address: "ул. Мира, 21", master: "Сергей Волков", status: "В работе", color: "violet" },
  { id: "visit-4", orderId: "ord-1245", time: "15:30", client: "ИП Иванов И.И.", address: "ул. Садовая, 3", master: "Алексей Смирнов", status: "Запланирован", color: "lime" },
  { id: "visit-5", orderId: "ord-1244", time: "17:00", client: "ООО «Орион»", address: "ул. Тверская, 7", master: "Дмитрий Кузнецов", status: "В работе", color: "violet" },
];

export const workTasks: WorkTask[] = [
  { id: "task-1", title: "Назначить мастера", meta: "Заказ №1245 · ИП Иванов", due: "09:00", urgent: true },
  { id: "task-2", title: "Отправить договор", meta: "ТСЖ «Пруды» · заказ №1247", due: "10:00" },
  { id: "task-3", title: "Проверить оплату", meta: "ООО «Орион» · 36 000 ₽", due: "12:00" },
  { id: "task-4", title: "Обновить состав препаратов", meta: "ООО «Домжилсервис»", due: "16:30" },
];

export const clients: Client[] = [
  { id: "cl-1", name: "ООО «Домжилсервис»", kind: "Юр. лицо", taxId: "7701234561", phone: "+7 495 123-45-67", email: "info@domgis.ru", objects: 5, orders: 12, contact: "Иванова Ирина" },
  { id: "cl-2", name: "ТСЖ «Пруды»", kind: "Юр. лицо", taxId: "7701234562", phone: "+7 495 678-45-21", email: "prudy@tsj.ru", objects: 3, orders: 7, contact: "Антон Рыжов" },
  { id: "cl-3", name: "ООО «Вектор»", kind: "Юр. лицо", taxId: "7701234563", phone: "+7 495 765-11-22", email: "office@vector.ru", objects: 2, orders: 4, contact: "Мария Белова" },
  { id: "cl-4", name: "ИП Иванов И.И.", kind: "Физ. лицо", taxId: "501234567890", phone: "+7 901 111-22-33", email: "ivanov@mail.ru", objects: 1, orders: 3, contact: "Иван Иванов" },
  { id: "cl-5", name: "ООО «Орион»", kind: "Юр. лицо", taxId: "7701234565", phone: "+7 495 987-68-01", email: "orion@mail.ru", objects: 4, orders: 10, contact: "Олег Ким" },
];
