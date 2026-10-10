import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  PackagePlus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, getApiAssetUrl, jsonBody } from "@/lib/api";
import { ErrorNotice, formatPrice, PageHeading } from "../shared";
import {
  AVAILABILITY_OPTIONS,
  type Availability,
  type Product,
  type ProductPhoto,
  type ProductRow,
  type ProductSpec,
} from "../types";

const blankProduct = (): Product => ({
  slug: "",
  name: "",
  category: "snowbike",
  brand: "",
  eyebrow: "",
  purpose: "",
  summary: "",
  image: "",
  imageAlt: "",
  gallery: [],
  tags: [],
  price: null,
  useCase: "",
  engine: "",
  horsepower: "",
  track: "",
  seats: "",
  specs: [],
});

export function ProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [draft, setDraft] = useState<Product>(blankProduct());
  const [editorOpen, setEditorOpen] = useState(false);
  const [availability, setAvailability] = useState<Availability>("on_order");
  const [published, setPublished] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [siteOutOfSync, setSiteOutOfSync] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [productsResult, settingsResult] = await Promise.allSettled([
      api<ProductRow[]>("/products"),
      api<{ githubConfigured: boolean }>("/settings/status"),
    ]);
    if (productsResult.status === "fulfilled") {
      setProducts(productsResult.value);
    } else {
      setError("Не удалось загрузить каталог. Проверьте соединение с базой.");
    }
    setGithubConfigured(
      settingsResult.status === "fulfilled" &&
        settingsResult.value.githubConfigured,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ru-RU");
    if (!term) return products;
    return products.filter((row) =>
      [row.name, row.slug, row.data.brand, row.category].some((value) =>
        String(value ?? "")
          .toLocaleLowerCase("ru-RU")
          .includes(term),
      ),
    );
  }, [products, search]);

  function startCreate() {
    setEditorOpen(true);
    setEditing(null);
    setDraft(blankProduct());
    setAvailability("on_order");
    setPublished(false);
    setFormDirty(false);
    setMessage("");
    setError("");
  }
  function startEdit(row: ProductRow) {
    setEditorOpen(true);
    setEditing(row);
    setDraft({
      ...blankProduct(),
      ...row.data,
      gallery: [...(row.data.gallery ?? [])],
      specs: [...(row.data.specs ?? [])],
      tags: [...(row.data.tags ?? [])],
    });
    setAvailability(row.availability);
    setPublished(row.is_published);
    setFormDirty(false);
    setMessage("");
    setError("");
    document
      .getElementById("product-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function patch<K extends keyof Product>(key: K, value: Product[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFormDirty(true);
  }
  function patchSpec(index: number, key: keyof ProductSpec, value: string) {
    setDraft((current) => ({
      ...current,
      specs: current.specs.map((spec, i) =>
        i === index ? { ...spec, [key]: value } : spec,
      ),
    }));
    setFormDirty(true);
  }

  async function uploadPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setError("");
    const next: ProductPhoto[] = [...draft.gallery];
    for (const file of files) {
      if (
        !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(
          file.type,
        )
      ) {
        setError("Поддерживаются фотографии JPG, PNG, WebP и AVIF.");
        continue;
      }
      if (file.size > 2 * 1024 * 1024) {
        setError("Размер одного изображения не должен превышать 2 МБ.");
        continue;
      }
      try {
        const dataUrl = await readAsDataUrl(file);
        const { src } = await api<{ src: string }>("/uploads", {
          method: "POST",
          body: jsonBody({
            filename: file.name,
            mimeType: file.type,
            base64: dataUrl.split(",")[1] || "",
          }),
        });
        next.push({ src, alt: draft.name || file.name, label: file.name });
      } catch {
        setError("Не удалось загрузить «" + file.name + "» на сервер CRM.");
      }
    }
    if (next.length !== draft.gallery.length) {
      setDraft((current) => ({
        ...current,
        gallery: next,
        image: current.image || next[0].src,
        imageAlt: current.imageAlt || next[0].alt,
      }));
      setFormDirty(true);
    }
    setUploading(false);
  }

  function movePhoto(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.gallery.length) return;
    const gallery = [...draft.gallery];
    [gallery[index], gallery[target]] = [gallery[target], gallery[index]];
    setDraft((current) => ({
      ...current,
      gallery,
      image: gallery[0]?.src ?? "",
      imageAlt: gallery[0]?.alt ?? "",
    }));
    setFormDirty(true);
  }
  function removePhoto(index: number) {
    const gallery = draft.gallery.filter((_, i) => i !== index);
    setDraft((current) => ({
      ...current,
      gallery,
      image: gallery[0]?.src ?? "",
      imageAlt: gallery[0]?.alt ?? "",
    }));
    setFormDirty(true);
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const slug = slugify(draft.slug || draft.name);
    if (!slug || !draft.name.trim()) {
      setError("Укажите название и адрес товара.");
      return;
    }
    const data: Product = {
      ...draft,
      slug,
      name: draft.name.trim(),
      image: draft.gallery[0]?.src ?? draft.image.trim(),
      imageAlt: draft.gallery[0]?.alt ?? draft.imageAlt.trim(),
      category: draft.category,
    };
    const row = {
      slug,
      category: data.category,
      name: data.name,
      data,
      availability,
      is_published: published,
      sort_order: editing?.sort_order ?? products.length,
    };
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await api<ProductRow>(
        editing ? "/products/" + encodeURIComponent(editing.id) : "/products",
        { method: editing ? "PUT" : "POST", body: jsonBody(row) },
      );
      setProducts((current) =>
        editing
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved].sort((a, b) => a.sort_order - b.sort_order),
      );
      setEditing(saved);
      setDraft({ ...data });
      setSiteOutOfSync(true);
      setFormDirty(false);
      setMessage(
        githubConfigured
          ? "Изменения сохранены в CRM. Закройте карточку, затем опубликуйте каталог на сайте."
          : "Изменения сохранены в CRM. Сайт обновится после подключения GitHub.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message.includes("уже занят")
          ? "Этот адрес товара уже используется. Выберите другой."
          : reason instanceof Error
            ? reason.message
            : "Не удалось сохранить товар.",
      );
    }
    setSaving(false);
  }

  async function deleteProduct(row: ProductRow) {
    if (
      !window.confirm(
        "Удалить товар «" + row.name + "»? Это действие нельзя отменить.",
      )
    )
      return;
    setError("");
    try {
      await api("/products/" + encodeURIComponent(row.id), {
        method: "DELETE",
      });
      setProducts((current) => current.filter((item) => item.id !== row.id));
      setSiteOutOfSync(true);
      if (editing?.id === row.id) startCreate();
    } catch {
      setError("Не удалось удалить товар.");
    }
  }

  async function publishCatalog() {
    setPublishing(true);
    setError("");
    setMessage("");
    try {
      const publication = await api<{ publication_id: string }>(
        "/catalog/publish",
        { method: "POST", body: "{}" },
      );
      const startedAt = Date.now();
      let finalStatus:
        | { status: "succeeded" | "failed"; error_message?: string | null }
        | undefined;
      while (Date.now() - startedAt < 60_000) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const status = await api<{
          lastPublication?: {
            id: string;
            status: string;
            error_message: string | null;
          } | null;
        }>("/settings/status");
        const last = status.lastPublication;
        if (
          last?.id === publication.publication_id &&
          (last.status === "succeeded" || last.status === "failed")
        ) {
          finalStatus = last as typeof finalStatus;
          break;
        }
      }
      if (finalStatus?.status === "succeeded") {
        setSiteOutOfSync(false);
        setMessage("Каталог опубликован на сайте.");
      } else if (finalStatus?.status === "failed") {
        setError(
          finalStatus.error_message ||
            "Публикация не завершилась. Проверьте настройки и попробуйте ещё раз.",
        );
      } else {
        setMessage(
          "Публикация всё ещё выполняется. Результат появится в разделе «Настройки».",
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось запустить публикацию каталога.",
      );
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section>
      <PageHeading
        eyebrow="SnowEnduro / товары"
        title="Каталог"
        description="Редактируйте карточки, характеристики и галереи каталога SnowEnduro."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void publishCatalog()}
              disabled={
                !githubConfigured ||
                !siteOutOfSync ||
                formDirty ||
                editorOpen ||
                publishing ||
                saving ||
                uploading
              }
              title={
                githubConfigured
                  ? "Опубликовать сохранённые изменения каталога на сайте"
                  : "Подключение GitHub на сервере CRM пока не настроено"
              }
            >
              <RefreshCw size={15} className="mr-2" />
              {publishing ? "Публикуем…" : "Опубликовать на сайт"}
            </Button>
            <Button onClick={startCreate}>
              <PackagePlus size={16} className="mr-2" />
              Новый товар
            </Button>
          </div>
        }
      />
      {!githubConfigured && (
        <p className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Синхронизация с сайтом пока не подключена. Товары сохраняются в CRM;
          публикация станет доступна после настройки GitHub в разделе{" "}
          <Link className="text-primary underline" to="/settings">
            «Настройки»
          </Link>
          .
        </p>
      )}
      {formDirty && (
        <p className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          Есть несохранённые изменения в карточке товара.
        </p>
      )}
      {siteOutOfSync && (
        <p className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          Сохранённые изменения каталога ещё не опубликованы на сайте.
        </p>
      )}
      {error && (
        <div className="mb-4">
          <ErrorNotice message={error} />
        </div>
      )}
      {message && (
        <p
          className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300"
          role="status"
        >
          {message}
        </p>
      )}

      {editorOpen && (
        <section
          id="product-editor"
          className="mb-6 scroll-mt-24 rounded-xl border border-border bg-card p-4 sm:p-6"
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                {editing ? "Редактирование" : "Новая карточка"}
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                {editing ? editing.name : "Товар"}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Закрыть редактор"
              onClick={() => {
                setEditorOpen(false);
                setFormDirty(false);
              }}
            >
              <X size={18} />
            </Button>
          </div>
          <form
            onSubmit={(event) => void saveProduct(event)}
            className="space-y-5"
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Название" required>
                <Input
                  value={draft.name}
                  maxLength={160}
                  required
                  onChange={(event) => {
                    const name = event.target.value;
                    setDraft((current) => ({
                      ...current,
                      name,
                      slug: current.slug ? current.slug : slugify(name),
                    }));
                    setFormDirty(true);
                  }}
                />
              </Field>
              <Field
                label="Адрес карточки"
                hint="Используется в ссылке на сайте"
              >
                <Input
                  value={draft.slug}
                  maxLength={120}
                  required
                  onChange={(event) =>
                    patch("slug", slugify(event.target.value))
                  }
                />
              </Field>
              <Field label="Категория" required>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.category}
                  onChange={(event) =>
                    patch("category", event.target.value as Product["category"])
                  }
                >
                  <option value="snowbike">Snowbike</option>
                  <option value="snowmobile">Снегоход</option>
                </select>
              </Field>
              <Field label="Марка">
                <Input
                  value={draft.brand}
                  maxLength={100}
                  onChange={(event) => patch("brand", event.target.value)}
                />
              </Field>
              <Field label="Цена" hint="Оставьте пустым для «Цена по запросу»">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.price ?? ""}
                  onChange={(event) =>
                    patch(
                      "price",
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                    )
                  }
                />
              </Field>
              <Field label="Наличие / предложение">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={availability}
                  onChange={(event) => {
                    setAvailability(event.target.value as Availability);
                    setFormDirty(true);
                  }}
                >
                  {AVAILABILITY_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Подпись над названием">
                <Input
                  value={draft.eyebrow}
                  maxLength={120}
                  onChange={(event) => patch("eyebrow", event.target.value)}
                />
              </Field>
              <Field label="Назначение">
                <Input
                  value={draft.purpose}
                  maxLength={160}
                  onChange={(event) => patch("purpose", event.target.value)}
                />
              </Field>
              <Field label="Сценарий использования">
                <Input
                  value={draft.useCase}
                  maxLength={160}
                  onChange={(event) => patch("useCase", event.target.value)}
                />
              </Field>
              <Field label="Двигатель">
                <Input
                  value={draft.engine}
                  maxLength={200}
                  onChange={(event) => patch("engine", event.target.value)}
                />
              </Field>
              <Field label="Мощность">
                <Input
                  value={draft.horsepower}
                  maxLength={120}
                  onChange={(event) => patch("horsepower", event.target.value)}
                />
              </Field>
              <Field label="Гусеница">
                <Input
                  value={draft.track}
                  maxLength={160}
                  onChange={(event) => patch("track", event.target.value)}
                />
              </Field>
              <Field label="Количество мест">
                <Input
                  value={draft.seats}
                  maxLength={80}
                  onChange={(event) => patch("seats", event.target.value)}
                />
              </Field>
              <Field label="Краткие метки" hint="Разделяйте запятыми">
                <Input
                  value={draft.tags.join(", ")}
                  onChange={(event) =>
                    patch(
                      "tags",
                      event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </Field>
            </div>
            <Field label="Короткое описание" required>
              <Textarea
                rows={3}
                maxLength={1800}
                required
                value={draft.summary}
                onChange={(event) => patch("summary", event.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Описание главного фото">
                <Input
                  value={draft.imageAlt}
                  maxLength={240}
                  onChange={(event) => patch("imageAlt", event.target.value)}
                />
              </Field>
              <Field
                label="Путь к главному фото"
                hint="Загрузка добавляет фото в галерею"
              >
                <Input
                  value={draft.image}
                  placeholder="/media/products/..."
                  onChange={(event) => patch("image", event.target.value)}
                />
              </Field>
            </div>

            <section className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium">Фотографии и галерея</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Первое изображение становится главным. Фото загружаются в
                    локальное хранилище сервера CRM.
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center rounded-md border border-input px-3 py-2 text-sm hover:bg-muted">
                  <ImagePlus size={16} className="mr-2" />
                  {uploading ? "Загружаем…" : "Добавить фотографии"}
                  <input
                    type="file"
                    className="sr-only"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    multiple
                    disabled={uploading}
                    onChange={(event) => void uploadPhotos(event)}
                  />
                </label>
              </div>
              {draft.gallery.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  Фотографии ещё не добавлены. Можно оставить текущие URL
                  каталога.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {draft.gallery.map((photo, index) => (
                    <div
                      key={photo.src + index}
                      className="flex items-center gap-2 rounded-md bg-muted/40 p-2"
                    >
                      <span className="w-7 shrink-0 text-center text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {photo.label || photo.alt}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {photo.src}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Выше"
                        disabled={index === 0}
                        onClick={() => movePhoto(index, -1)}
                      >
                        <ArrowUp size={15} />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Ниже"
                        disabled={index === draft.gallery.length - 1}
                        onClick={() => movePhoto(index, 1)}
                      >
                        <ArrowDown size={15} />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Убрать из галереи"
                        onClick={() => removePhoto(index)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium">Характеристики</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Все параметры карточки сайта сохраняются в указанном
                    порядке.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraft((current) => ({
                      ...current,
                      specs: [...current.specs, { label: "", value: "" }],
                    }));
                    setFormDirty(true);
                  }}
                >
                  Добавить строку
                </Button>
              </div>
              {draft.specs.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Характеристики пока не добавлены.
                </p>
              )}
              <div className="space-y-2">
                {draft.specs.map((spec, index) => (
                  <div
                    className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]"
                    key={index}
                  >
                    <Input
                      aria-label="Название характеристики"
                      placeholder="Параметр"
                      value={spec.label}
                      onChange={(event) =>
                        patchSpec(index, "label", event.target.value)
                      }
                    />
                    <Input
                      aria-label="Значение характеристики"
                      placeholder="Значение"
                      value={spec.value}
                      onChange={(event) =>
                        patchSpec(index, "value", event.target.value)
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Удалить строку"
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          specs: current.specs.filter((_, i) => i !== index),
                        }));
                        setFormDirty(true);
                      }}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  className="size-4 accent-primary"
                  type="checkbox"
                  checked={published}
                  onChange={(event) => {
                    setPublished(event.target.checked);
                    setFormDirty(true);
                  }}
                />
                Показывать на сайте после синхронизации
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditorOpen(false);
                    setFormDirty(false);
                  }}
                >
                  Отмена
                </Button>
                <Button type="submit" disabled={saving || uploading}>
                  <Save size={15} className="mr-2" />
                  {saving ? "Сохраняем…" : "Сохранить товар"}
                </Button>
              </div>
            </div>
          </form>
        </section>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Найти товар"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Button
          variant="outline"
          size="icon"
          aria-label="Обновить список"
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          <RefreshCw size={16} />
        </Button>
      </div>
      {loading ? (
        <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Загружаем каталог…
        </p>
      ) : visibleProducts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Товаров нет. Добавьте первую карточку.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProducts.map((row) => (
            <article
              key={row.id}
              className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <ProductImage src={row.data.image} alt={row.data.imageAlt} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
                    {row.category === "snowbike" ? "Snowbike" : "Снегоход"} ·{" "}
                    {row.data.brand}
                  </p>
                  <h2 className="mt-1 line-clamp-2 font-semibold">
                    {row.name}
                  </h2>
                  <p className="mt-1 text-sm text-primary">
                    {formatPrice(row.data.price)}
                  </p>
                </div>
              </div>
              <p className="mt-4 line-clamp-2 min-h-10 text-sm text-muted-foreground">
                {row.data.summary}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-border px-2.5 py-1 text-xs">
                  {
                    AVAILABILITY_OPTIONS.find(
                      (item) => item.value === row.availability,
                    )?.label
                  }
                </span>
                <span
                  className={
                    "rounded-full border px-2.5 py-1 text-xs " +
                    (row.is_published
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                      : "border-border text-muted-foreground")
                  }
                >
                  {row.is_published
                    ? "На сайте после синхронизации"
                    : "Скрыт с сайта"}
                </span>
              </div>
              <div className="mt-auto flex gap-2 pt-4">
                <Button
                  className="flex-1"
                  variant="outline"
                  onClick={() => startEdit(row)}
                >
                  Изменить
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Удалить товар"
                  onClick={() => void deleteProduct(row)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="mt-4 text-right text-xs text-muted-foreground">
        {visibleProducts.length} из {products.length} карточек
      </p>
    </section>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      {label}
      {required && <span className="text-primary"> *</span>}
      {children}
      {hint && (
        <span className="block text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}

function ProductImage({ src, alt }: { src: string; alt: string }) {
  const url = src.startsWith("/uploads/")
    ? getApiAssetUrl(src)
    : src.startsWith("/")
      ? `https://snowenduro.ru${src}`
      : src;
  return (
    <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted">
      {url ? (
        <img
          src={url}
          alt={alt}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <ImagePlus className="size-5 text-muted-foreground" />
      )}
    </div>
  );
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Не удалось прочитать фотографию."));
    reader.onerror = () =>
      reject(reader.error || new Error("Ошибка чтения файла."));
    reader.readAsDataURL(file);
  });
}

function slugify(value: string) {
  const map: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "i",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya",
  };
  return value
    .toLowerCase()
    .split("")
    .map((char) => map[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}
