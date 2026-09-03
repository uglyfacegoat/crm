import type { MasterDetail, MasterListItem } from "./types";

const names = ["Алексей Смирнов", "Дмитрий Кузнецов", "Сергей Волков", "Мария Смирнова"];

export function getPreviewMasters(): MasterListItem[] {
  return names.map((fullName, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    fullName,
    phone: `+7 999 000-00-0${index + 1}`,
    messenger: `@master_${index + 1}`,
    serviceRegion: "Москва",
    serviceZone: ["ЦАО", "САО", "ЮАО", "ВАО"][index],
    basePaymentMinor: (3_500 + index * 250) * 100,
    dailyCapacity: 4,
    skills: ["Дератизация", "Дезинсекция"],
    notes: null,
    operationalStatus: "working",
    workingDays: [1, 2, 3, 4, 5],
    statusUntil: null,
    statusNote: null,
    active: true,
    version: 1,
    todayVisitCount: index,
    loadPercent: index * 25,
    statusCode: index ? "scheduled" : "available",
    statusLabel: index ? "С выездами" : "Свободен",
    todayVisits: [],
  }));
}

export function getPreviewMasterDetail(masterId: string): MasterDetail | null {
  const master = getPreviewMasters().find((entry) => entry.id === masterId);
  if (!master) return null;
  return { ...master, totalVisits: 0, completedVisits: 0, upcomingVisits: 0, totalOrders: 0, accruedMinor: 0, paidMinor: 0, recentVisits: [] };
}
