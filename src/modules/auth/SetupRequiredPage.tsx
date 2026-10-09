import { AlertTriangle } from "lucide-react";

export function SetupRequiredPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-7 sm:p-9">
        <AlertTriangle className="mb-5 size-8 text-primary" />
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Первичная настройка
        </p>
        <h1 className="text-2xl font-semibold">CRM ещё не подключена</h1>
        <p className="mt-3 leading-6 text-muted-foreground">
          Настройте адрес Supabase и публичный ключ в локальном окружении.
          Сервер и учётную запись администратора нужно подготовить отдельно по
          инструкции проекта.
        </p>
      </section>
    </main>
  );
}
