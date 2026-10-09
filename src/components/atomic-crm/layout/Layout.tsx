import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Notification } from "@/components/admin/notification";
import { Error } from "@/components/admin/error";
import { Skeleton } from "@/components/ui/skeleton";
import Header from "./Header";

export const Layout = ({ children }: { children: ReactNode }) => (
  <>
    <Header />
    <main
      className="mx-auto min-h-[calc(100vh-4rem)] max-w-screen-2xl px-4 py-6 pb-24 sm:px-6 md:pb-8"
      id="main-content"
    >
      <ErrorBoundary FallbackComponent={Error}>
        <Suspense fallback={<Skeleton className="h-12 w-12 rounded-full" />}>
          {children}
        </Suspense>
      </ErrorBoundary>
    </main>
    <Notification />
  </>
);
