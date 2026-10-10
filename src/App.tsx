import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  BellRing,
  Boxes,
  ClipboardList,
  LogOut,
  Settings,
  Snowflake,
} from "lucide-react";
import {
  HashRouter,
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useNavigate,
} from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, jsonBody } from "@/lib/api";
import snowenduroLogo from "./assets/snowenduro-mark.svg";
import { LeadDetailsPage } from "./modules/leads/LeadDetailsPage";
import { LeadsPage } from "./modules/leads/LeadsPage";
import { ProductsPage } from "./modules/products/ProductsPage";
import { SnowSettingsPage } from "./modules/settings/SnowSettingsPage";
import { TelegramPage } from "./modules/telegram/TelegramPage";

type AuthStatus = {
  setupRequired: boolean;
  authenticated: boolean;
  email: string | null;
};

const links = [
  { to: "/leads", label: "Заявки", icon: ClipboardList },
  { to: "/products", label: "Каталог", icon: Boxes },
  { to: "/telegram", label: "Telegram", icon: BellRing },
  { to: "/settings", label: "Настройки", icon: Settings },
];

export default function App() {
  return (
    <HashRouter>
      <AuthRoutes />
    </HashRouter>
  );
}

function AuthRoutes() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [offline, setOffline] = useState(false);

  async function refresh() {
    try {
      setStatus(await api<AuthStatus>("/auth/status"));
      setOffline(false);
    } catch {
      setOffline(true);
      setStatus(null);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  if (offline) return <ServerUnavailable />;
  if (!status)
    return (
      <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Подключаемся к CRM…
      </main>
    );

  return (
    <Routes>
      <Route
        path="/setup"
        element={
          status.setupRequired ? (
            <SetupPage onComplete={refresh} />
          ) : (
            <Navigate to={status.authenticated ? "/leads" : "/login"} replace />
          )
        }
      />
      <Route
        path="/login"
        element={
          status.setupRequired ? (
            <Navigate to="/setup" replace />
          ) : status.authenticated ? (
            <Navigate to="/leads" replace />
          ) : (
            <LoginPage onComplete={refresh} />
          )
        }
      />
      <Route
        element={
          status.authenticated ? (
            <AppLayout email={status.email || ""} onLogout={refresh} />
          ) : (
            <Navigate to={status.setupRequired ? "/setup" : "/login"} replace />
          )
        }
      >
        <Route path="/" element={<Navigate to="/leads" replace />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/leads/:id" element={<LeadDetailsPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/telegram" element={<TelegramPage />} />
        <Route path="/settings" element={<SnowSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AppLayout({
  email,
  onLogout,
}: {
  email: string;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
    } finally {
      await onLogout();
      navigate("/login", { replace: true });
    }
  }
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-screen-2xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/leads" className="flex shrink-0 items-center gap-2.5">
            <img className="h-8 w-auto" src={snowenduroLogo} alt="SnowEnduro" />
            <span className="hidden text-sm font-semibold sm:inline">CRM</span>
          </Link>
          <nav className="flex min-w-0 flex-1 justify-center gap-1 overflow-x-auto sm:gap-2">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  "inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors " +
                  (isActive
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground")
                }
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden max-w-44 truncate text-xs text-muted-foreground lg:block">
              {email}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Выйти"
              title="Выйти"
              onClick={() => void logout()}
            >
              <LogOut size={17} />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-screen-2xl px-4 py-6 pb-24 sm:px-6 md:pb-8">
        <Outlet />
      </main>
    </div>
  );
}

function AuthCard({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/20 sm:p-9">
        <img
          className="mb-8 h-12 w-auto"
          src={snowenduroLogo}
          alt="SnowEnduro"
        />
        {children}
      </section>
    </main>
  );
}

function LoginPage({ onComplete }: { onComplete: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api("/auth/login", {
        method: "POST",
        body: jsonBody({ email, password }),
      });
      await onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось войти.");
    } finally {
      setPending(false);
    }
  }
  return (
    <AuthCard>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
        Рабочее пространство
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Вход в CRM</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Войдите по учетной записи администратора.
      </p>
      <form className="mt-7 space-y-5" onSubmit={(event) => void submit(event)}>
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
      <p className="mt-7 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
        Доступ выдаётся только администратором. Пароль хранится в базе в
        защищённом виде.
      </p>
    </AuthCard>
  );
}

function SetupPage({ onComplete }: { onComplete: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("Пароли не совпадают.");
      return;
    }
    setPending(true);
    try {
      await api("/auth/setup", {
        method: "POST",
        body: jsonBody({ email, password, setupToken }),
      });
      await onComplete();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось создать администратора.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <AuthCard>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
        Первый запуск
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        Создайте администратора
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Эта учетная запись будет единственным способом войти в CRM. Задайте
        пароль от 12 символов.
      </p>
      <form className="mt-7 space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block space-y-2 text-sm font-medium">
          Электронная почта
          <Input
            autoComplete="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="block space-y-2 text-sm font-medium">
          Пароль
          <Input
            autoComplete="new-password"
            type="password"
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <label className="block space-y-2 text-sm font-medium">
          Повторите пароль
          <Input
            autoComplete="new-password"
            type="password"
            minLength={12}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
        </label>
        <label className="block space-y-2 text-sm font-medium">
          Код первичной настройки{" "}
          <span className="font-normal text-muted-foreground">
            (если задан на сервере)
          </span>
          <Input
            autoComplete="off"
            type="password"
            value={setupToken}
            onChange={(event) => setSetupToken(event.target.value)}
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
          {pending ? "Создаём…" : "Создать CRM"}
        </Button>
      </form>
    </AuthCard>
  );
}

function ServerUnavailable() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/20 sm:p-9">
        <div className="mb-7 flex items-center gap-3">
          <Snowflake className="text-primary" />
          <img className="h-9 w-auto" src={snowenduroLogo} alt="SnowEnduro" />
        </div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Сервер не подключён
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          CRM работает на своём сервере
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Эта страница размещена на GitHub Pages, где нет базы и серверной
          части. Персональные данные здесь не сохраняются. Для общей CRM
          приложение и API должны работать вместе на уже имеющемся сервере.
        </p>
        <Button
          className="mt-5"
          variant="outline"
          onClick={() => window.location.reload()}
        >
          Проверить ещё раз
        </Button>
        <p className="mt-5 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
          Публичный просмотр не подключён к данным CRM.
        </p>
      </section>
    </main>
  );
}
