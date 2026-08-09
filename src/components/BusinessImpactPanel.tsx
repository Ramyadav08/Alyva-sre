"use client";

/**
 * Leads with the number a stakeholder actually cares about — not traces,
 * not metrics, revenue/user-experience risk right now — with the evidence
 * behind it one click away. This is the panel the plan calls out as most
 * important: "the main concern of any business holder is not the traces
 * and metrics... it's what is the business impact." Rebuilt on shadcn/ui:
 * Card, Badge for the active/no-active-impact state. Kept as a manual
 * Button toggle rather than Accordion — this is a single conditional
 * detail block, not a list of rows, so Accordion's list semantics don't
 * fit as cleanly as they do elsewhere in this pass.
 */
import { useEffect, useState } from "react";
import type { BusinessImpactSummary } from "@/lib/business-impact";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function BusinessImpactPanel() {
  const [summary, setSummary] = useState<BusinessImpactSummary | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function refresh() {
      const res = await fetch("/api/dashboard/business-impact");
      setSummary(await res.json());
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  if (!summary) return null;

  if (summary.checkedServiceCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Business impact</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            No revenue-bearing services confirmed yet — answer the onboarding questions above to
            start tracking this.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Business impact</CardTitle>
        <Badge variant={summary.hasActiveImpact ? "error" : "success"}>
          {summary.hasActiveImpact ? "active" : "no active impact"}
        </Badge>
      </CardHeader>
      <CardContent className="pt-0">
        {summary.hasActiveImpact ? (
          <p className="text-2xl font-semibold text-error">
            ~${summary.totalEstimatedUsdPerMinute.toFixed(0)}/min at risk
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              across {summary.impactedServices.length} service(s)
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            All {summary.checkedServiceCount} revenue-bearing service(s) are within their normal
            baseline right now.
          </p>
        )}

        {summary.hasActiveImpact && (
          <>
            <Button variant="ghost" size="sm" className="mt-2 h-auto p-0 underline" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "hide detail" : "show detail"}
            </Button>
            {expanded && (
              <ul className="mt-2 space-y-2">
                {summary.impactedServices.map((s) => (
                  <li key={s.serviceId} className="rounded border border-border p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono">{s.serviceId}</span>
                      <span className="text-muted-foreground">
                        {s.estimatedUsdPerMinute !== null ? `~$${s.estimatedUsdPerMinute}/min` : "impact unknown"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.evidence.map((e, i) => (
                        <span key={i} className="evidence-chip" title={e.query}>
                          {e.type}: {e.summary}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
