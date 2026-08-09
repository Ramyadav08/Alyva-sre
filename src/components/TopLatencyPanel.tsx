"use client";

/**
 * Top services by real inter-service call latency, from the live
 * Tempo-derived service graph (lib/lgtm.ts's getServiceTrafficEdges) —
 * directly answers the plan's "top services having the latency between
 * the service and call request" requirement. Collapsed to the top 5 by
 * default; the rest is a click away, not dumped. Rebuilt on shadcn/ui:
 * Card, Progress for each ranking bar (same treatment as the confidence
 * meter elsewhere), Button for show more/fewer.
 */
import { useEffect, useState } from "react";
import type { TrafficEdge } from "@/lib/lgtm";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

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
      <Card>
        <CardHeader>
          <CardTitle>Top latency between services</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">No cross-service call data observed yet.</p>
        </CardContent>
      </Card>
    );
  }

  const visible = showAll ? edges : edges.slice(0, VISIBLE_DEFAULT);
  const maxLatency = Math.max(...edges.map((e) => e.avgLatencyMs));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top latency between services</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {visible.map((e, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            <span className="w-48 truncate font-mono text-xs">
              {e.source} → {e.target}
            </span>
            <Progress value={(e.avgLatencyMs / maxLatency) * 100} className="h-2 flex-1" />
            <span className="w-16 text-right font-mono text-xs">{e.avgLatencyMs.toFixed(0)}ms</span>
            {e.errorCount > 0 && (
              <span className="text-xs text-error" title={`${e.errorCount} error(s) observed on this edge`}>
                {e.errorCount} err
              </span>
            )}
          </div>
        ))}
        {edges.length > VISIBLE_DEFAULT && (
          <Button variant="ghost" size="sm" className="h-auto p-0 text-xs underline" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "show fewer" : `show ${edges.length - VISIBLE_DEFAULT} more`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
