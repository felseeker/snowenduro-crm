import { AlertTriangle } from "lucide-react";

export function SetupRequiredPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-7 sm:p-9">
        <AlertTriangle className="mb-5 size-8 text-primary" />
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Первичная настройка
        </p>
        <h1 className="text-2xl font-semibold">Регистрация закрыта</h1>
        <p className="mt-3 leading-6 text-muted-foreground">
          Самостоятельное создание учётных записей недоступно. Первый
          администратор создаётся при защищённой первичной настройке сервера;
          дальнейший вход выполняется по его логину и паролю.
        </p>
      </section>
    </main>
  );
}
