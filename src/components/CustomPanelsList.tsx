"use client";

/**
 * Persisted custom panels — each re-queries its own live data on mount
 * and on a refresh interval, never replays the drafting-time snapshot.
 * Removable at any time (the plan's explicit requirement: kept panels
 * aren't permanent). Rebuilt on shadcn/ui: Card, Button (Remove),
 * Progress for ranking-shaped panel data — same treatment as
 * CustomPanelChat's draft preview.
 */
import { useEffect, useState } from "react";
import type { DashboardPanelSpec } from "@/lib/models";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

function PanelData({ id }: { id: string }) {
  const [data, setData] = useState<unknown[] | null>(null);

  useEffect(() => {
    async function refresh() {
      const res = await fetch(`/api/dashboard/panels/${id}/data`);
      const json = await res.json();
      setData(Array.isArray(json.data) ? json.data : []);
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [id]);

  if (!data) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (data.length === 0) return <p className="text-xs text-muted-foreground">No live data right now.</p>;

  if (typeof data[0] === "object" && data[0] !== null && "label" in (data[0] as any)) {
    const rows = data as Array<{ label: string; value: number; unit: string }>;
    const max = Math.max(...rows.map((r) => r.value));
    return (
      <ul className="space-y-1">
        {rows.slice(0, 8).map((r, i) => (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className="w-40 truncate font-mono text-xs">{r.label}</span>
            <Progress value={(r.value / max) * 100} className="h-2 flex-1" />
            <span className="w-16 text-right font-mono text-xs">
              {r.value.toFixed(1)}{r.unit}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  const points = data as Array<{ ts: number; value: number }>;
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <div className="flex h-12 items-end gap-0.5">
      {points.slice(-40).map((p, i) => (
        <div key={i} className="flex-1 rounded-t bg-brand/70" style={{ height: `${Math.max(4, (p.value / max) * 100)}%` }} />
      ))}
    </div>
  );
}

export function CustomPanelsList() {
  const [panels, setPanels] = useState<DashboardPanelSpec[]>([]);

  async function refresh() {
    const res = await fetch("/api/dashboard/panels");
    const { panels } = await res.json();
    setPanels(panels);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function remove(id: string) {
    await fetch(`/api/dashboard/panels/${id}`, { method: "DELETE" });
    await refresh();
  }

  if (panels.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {panels.map((p) => (
        <Card key={p.id}>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{p.title}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => remove(p.id)}>
              Remove
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <PanelData id={p.id} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
