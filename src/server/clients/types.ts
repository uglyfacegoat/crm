export type ClientKind = "legal_entity" | "individual";

export type ClientContact = {
  id: string;
  fullName: string;
  position: string | null;
  phone: string;
  email: string | null;
  isPrimary: boolean;
  createdAt: string;
};

export type ClientObject = {
  id: string;
  name: string;
  objectType: string;
  address: string;
  areaSquareMeters: number | null;
  floorCount: number | null;
  onsiteContact: string | null;
  accessInstructions: string | null;
  parkingNotes: string | null;
  restrictions: string | null;
  riskLevel: number | null;
  infestationLevel: number | null;
  createdAt: string;
};

export type ClientDetail = {
  id: string;
  legalName: string;
  kind: ClientKind;
  taxId: string | null;
  primaryPhone: string | null;
  primaryEmail: string | null;
  version: number;
  createdAt: string;
  contacts: ClientContact[];
  objects: ClientObject[];
  orderCount: number;
};
