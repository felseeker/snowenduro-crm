export type ProductCategory = "snowbike" | "snowmobile";
export type ProductSpec = { label: string; value: string };
export type ProductPhoto = {
  src: string;
  alt: string;
  label: string;
  treatment?: "cutout" | "scene";
};
export type Product = {
  slug: string;
  name: string;
  category: ProductCategory;
  brand: string;
  eyebrow: string;
  purpose: string;
  summary: string;
  image: string;
  imageAlt: string;
  imageTreatment?: "cutout" | "scene";
  gallery: ProductPhoto[];
  tags: string[];
  price: number | null;
  useCase: string;
  engine: string;
  horsepower: string;
  track: string;
  seats: string;
  specs: ProductSpec[];
};
export type Availability = "in_stock" | "on_order" | "out_of_stock";
export type ProductRow = {
  id: string;
  slug: string;
  category: ProductCategory;
  name: string;
  data: Product;
  availability: Availability;
  is_published: boolean;
  sort_order: number;
  updated_at: string;
};
export type LeadStatus =
  | "new"
  | "in_progress"
  | "supplier"
  | "sale"
  | "rejected";
export type WebsiteLead = {
  id: string;
  public_code: number;
  created_at: string;
  customer_name: string;
  phone: string;
  product_interest: string;
  source_page: string;
  compatibility_make: string | null;
  compatibility_model: string | null;
  compatibility_year: number | null;
  manager_comments: string;
  status: LeadStatus;
};
export type TelegramRecipient = {
  id: string;
  chat_id: string;
  label: string | null;
  is_enabled: boolean;
};

export const LEAD_STATUSES: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "Новая" },
  { value: "in_progress", label: "В работе" },
  { value: "supplier", label: "Передана поставщику" },
  { value: "sale", label: "Продажа" },
  { value: "rejected", label: "Отказ" },
];

export const AVAILABILITY_OPTIONS: { value: Availability; label: string }[] = [
  { value: "in_stock", label: "В наличии" },
  { value: "on_order", label: "Под заказ" },
  { value: "out_of_stock", label: "Нет в наличии" },
];
