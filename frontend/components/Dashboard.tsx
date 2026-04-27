"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { getHealth, type HealthResponse } from "@/lib/api";

const MapViewport = dynamic(
  () => import("@/components/MapViewport").then((mod) => mod.MapViewport),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-muted">
        Loading map
      </div>
    )
  }
);

type BackendState =
  | { status: "loading"; message: string }
  | { status: "online"; data: HealthResponse }
  | { status: "offline"; message: string };

export function Dashboard() {
  const [backend, setBackend] = useState<BackendState>({
    status: "loading",
    message: "Checking backend"
  });

  useEffect(() => {
    let isMounted = true;

    getHealth()
      .then((data) => {
        if (isMounted) {
          setBackend({ status: "online", data });
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setBackend({
            status: "offline",
            message:
              error instanceof Error
                ? error.message
                : "Unable to reach backend"
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const isOnline = backend.status === "online";

  return (
    <main className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-5">
        <header className="flex flex-col gap-4 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.12em] text-accent">
              Drone imagery
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-ink">
              Semantic segmentation workspace
            </h1>
          </div>
          <div className="flex items-center gap-3 rounded border border-line bg-white px-4 py-3 shadow-sm">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isOnline ? "bg-emerald-500" : "bg-rose-500"
              }`}
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-semibold text-ink">
                Backend {isOnline ? "online" : "not connected"}
              </p>
              <p className="text-xs text-muted">
                {backend.status === "online"
                  ? `${backend.data.service}: ${backend.data.status}`
                  : backend.message}
              </p>
            </div>
          </div>
        </header>

        <section className="grid flex-1 gap-5 py-5 lg:grid-cols-[320px_1fr]">
          <aside className="rounded border border-line bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">Image workflow</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded border border-dashed border-line bg-slate-50 p-4">
                <p className="text-sm font-medium text-ink">Upload imagery</p>
                <p className="mt-1 text-sm text-muted">
                  Upload and inference endpoints will be added after the backend
                  model service is introduced.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Boxes" value="0" />
                <Metric label="Masks" value="0" />
              </div>
            </div>
          </aside>

          <section className="min-h-[520px] overflow-hidden rounded border border-line bg-white shadow-sm">
            <MapViewport />
          </section>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}

