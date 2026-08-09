"use client";

/**
 * Top services by real inter-service call latency, from the live
 * Tempo-derived service graph (lib/lgtm.ts's getServiceTrafficEdges) —
 * directly answers the plan's "top services having the latency between
 * the service and call request" requirement. Collapsed to the top 5 by
 * default; the rest is a click away, not dumped.
 */
import { useEffect, useState } from "react";
import type { TrafficEdge } from "@/lib/lgtm";

const VISIBLE_DEFAULT = 5;

export function TopLatencyPanel() {
  const [edges, setEdges] = useState<TrafficEdge[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    async function refresh() {
      const res = await fetch("/api/dashboard/top-latency");
      const { edges } = await res.json();
      setEdges(edges);
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  if (edges.length === 0) {
    return (
      <div className="surface-card">
        <h2 className="text-sm font-semibold">Top latency between services</h2>
        <p className="mt-1 text-sm text-muted-foreground">No cross-service call data observed yet.</p>
      </div>
    );
  }

  const visible = showAll ? edges : edges.slice(0, VISIBLE_DEFAULT);
  const maxLatency = Math.max(...edges.map((e) => e.avgLatencyMs));

  return (
    <div className="surface-card">
      <h2 className="text-sm font-semibold">Top latency between services</h2>
      <ul className="mt-2 space-y-1.5">
        {visible.map((e, i) => (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className="w-48 truncate font-mono text-xs">
              {e.source} → {e.target}
            </span>
            <div className="h-2 flex-1 rounded bg-muted">
              <div
                className="h-2 rounded bg-brand"
                style={{ width: `${Math.max(4, (e.avgLatencyMs / maxLatency) * 100)}%` }}
              />
            </div>
            <span className="w-16 text-right font-mono text-xs">{e.avgLatencyMs.toFixed(0)}ms</span>
            {e.errorCount > 0 && (
              <span className="text-xs text-error" title={`${e.errorCount} error(s) observed on this edge`}>
                {e.errorCount} err
              </span>
            )}
          </li>
        ))}
      </ul>
      {edges.length > VISIBLE_DEFAULT && (
        <button className="mt-2 text-xs text-muted-foreground underline" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "show fewer" : `show ${edges.length - VISIBLE_DEFAULT} more`}
        </button>
      )}
    </div>
  );
}
