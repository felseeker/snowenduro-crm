import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, jsonBody } from "@/lib/api";
import { ErrorNotice, formatDate, PageHeading, StatusPill } from "../shared";
import { LEAD_STATUSES, type LeadStatus, type WebsiteLead } from "../types";

export function LeadDetailsPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState<WebsiteLead | null>(null);
  const [comments, setComments] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void api<WebsiteLead>("/leads/" + encodeURIComponent(id))
      .then((data) => {
        if (!active) return;
        setLead(data);
        setComments(data.manager_comments ?? "");
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError("Заявка не найдена или доступ к ней запрещён.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function changeStatus(next: LeadStatus) {
    if (!lead) return;
    setError("");
    try {
      const updated = await api<WebsiteLead>(
        "/leads/" + encodeURIComponent(lead.id),
        {
          method: "PATCH",
          body: jsonBody({ status: next }),
        },
      );
      setLead(updated);
    } catch {
      setError("Не удалось изменить статус.");
    }
  }

  async function saveComments() {
    if (!lead) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const updated = await api<WebsiteLead>(
        "/leads/" + encodeURIComponent(lead.id),
        {
          method: "PATCH",
          body: jsonBody({ manager_comments: comments.trim() }),
        },
      );
      setLead(updated);
      setSaved(true);
    } catch {
      setError("Не удалось сохранить комментарий.");
    }
    setSaving(false);
  }

  if (loading)
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Загружаем карточку…
      </p>
    );
  if (!lead)
    return (
      <section>
        <PageHeading eyebrow="Клиентская карточка" title="Заявка недоступна" />
        <ErrorNotice message={error || "Заявка не найдена."} />
        <Button
          className="mt-5"
          variant="outline"
          onClick={() => navigate("/leads")}
        >
          <ArrowLeft size={16} className="mr-2" />К списку заявок
        </Button>
      </section>
    );

  return (
    <section>
      <Link
        className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
        to="/leads"
      >
        <ArrowLeft size={16} />
        Все заявки
      </Link>
      <PageHeading
        eyebrow="Карточка клиента"
        title={lead.customer_name}
        description={
          "Заявка #" +
          String(lead.public_code).padStart(4, "0") +
          " · " +
          formatDate(lead.created_at)
        }
        action={<StatusPill status={lead.status} />}
      />
      {error && (
        <div className="mb-5">
          <ErrorNotice message={error} />
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <h2 className="text-base font-semibold">Данные обращения</h2>
            <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Detail label="Телефон">
                <a
                  className="font-medium text-primary hover:underline"
                  href={"tel:" + lead.phone}
                >
                  {lead.phone}
                </a>
              </Detail>
              <Detail label="Интересующий товар">
                {lead.product_interest}
              </Detail>
              <Detail label="Страница сайта">
                <span className="break-all">
                  {sourceLabel(lead.source_page)}
                </span>
              </Detail>
              {lead.compatibility_make && (
                <Detail label="Марка эндуро">{lead.compatibility_make}</Detail>
              )}
              {lead.compatibility_model && (
                <Detail label="Модель">{lead.compatibility_model}</Detail>
              )}
              {lead.compatibility_year && (
                <Detail label="Год выпуска">{lead.compatibility_year}</Detail>
              )}
            </dl>
          </section>
          <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">Работа с заявкой</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Изменение статуса сохраняется сразу.
                </p>
              </div>
              <select
                aria-label="Статус заявки"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-64"
                value={lead.status}
                onChange={(event) =>
                  void changeStatus(event.target.value as LeadStatus)
                }
              >
                {LEAD_STATUSES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="mt-6 block space-y-2 text-sm font-medium">
              Комментарий менеджера
              <Textarea
                rows={5}
                maxLength={5000}
                value={comments}
                onChange={(event) => setComments(event.target.value)}
                placeholder="Запишите договоренности и следующий шаг"
              />
            </label>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {comments.length}/5000
              </span>
              <div className="flex items-center gap-3">
                {saved && (
                  <span className="text-xs text-emerald-400">Сохранено</span>
                )}
                <Button onClick={() => void saveComments()} disabled={saving}>
                  <Save size={15} className="mr-2" />
                  {saving ? "Сохраняем…" : "Сохранить комментарий"}
                </Button>
              </div>
            </div>
          </section>
        </div>
        <aside className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="font-semibold">История и источник</h2>
          <dl className="mt-4 space-y-4 text-sm">
            <Detail label="Дата и время">{formatDate(lead.created_at)}</Detail>
            <Detail label="Номер обращения">
              #{String(lead.public_code).padStart(4, "0")}
            </Detail>
            <Detail label="Статус">
              <StatusPill status={lead.status} />
            </Detail>
            <Detail label="Источник">
              <span className="break-all">{lead.source_page}</span>
            </Detail>
          </dl>
          <a
            className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            href={"tel:" + lead.phone}
          >
            Позвонить клиенту
          </a>
        </aside>
      </div>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-medium">{children}</dd>
    </div>
  );
}

function sourceLabel(value: string) {
  try {
    return new URL(value).pathname || "/";
  } catch {
    return value;
  }
}
