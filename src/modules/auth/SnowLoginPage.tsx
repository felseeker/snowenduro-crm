import { useState, type FormEvent } from "react";
import { useLogin } from "ra-core";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SnowLoginPage() {
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await login({ username: email.trim(), password });
    } catch {
      setError("Не удалось войти. Проверьте электронную почту и пароль.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-background px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/20 sm:p-9">
        <img
          className="mb-8 h-12 w-auto"
          src="/snowenduro-mark.svg"
          alt="SnowEnduro"
        />
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Рабочее пространство
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Вход в CRM</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Войдите по учетной записи администратора.
        </p>
        <form className="mt-7 space-y-5" onSubmit={submit}>
          <label className="block space-y-2 text-sm font-medium">
            Электронная почта
            <Input
              autoComplete="username"
              inputMode="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="block space-y-2 text-sm font-medium">
            Пароль
            <Input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && (
            <p
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? "Входим…" : "Войти"}
          </Button>
        </form>
        <div className="mt-5 text-center text-sm text-muted-foreground">
          <Link
            className="underline underline-offset-4 hover:text-foreground"
            to="/forgot-password"
          >
            Забыли пароль?
          </Link>
        </div>
        <p className="mt-7 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
          Учетные записи создаются только администратором. Самостоятельная
          регистрация закрыта.
        </p>
      </section>
    </main>
  );
}
