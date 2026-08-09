"use client";

/**
 * Leads with the number a stakeholder actually cares about — not traces,
 * not metrics, revenue/user-experience risk right now — with the evidence
 * behind it one click away. This is the panel the plan calls out as most
 * important: "the main concern of any business holder is not the traces
 * and metrics... it's what is the business impact."
 */
import { useEffect, useState } from "react";
import type { BusinessImpactSummary } from "@/lib/business-impact";

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
      <div className="rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Business impact</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          No revenue-bearing services confirmed yet — answer the onboarding questions above to
          start tracking this.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Business impact</h2>
        {summary.hasActiveImpact ? (
          <span className="rounded-full bg-error/10 px-2 py-0.5 text-xs font-medium text-error">active</span>
        ) : (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
            no active impact
          </span>
        )}
      </div>

      {summary.hasActiveImpact ? (
        <p className="mt-2 text-2xl font-semibold text-error">
          ~${summary.totalEstimatedUsdPerMinute.toFixed(0)}/min at risk
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            across {summary.impactedServices.length} service(s)
          </span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          All {summary.checkedServiceCount} revenue-bearing service(s) are within their normal
          baseline right now.
        </p>
      )}

      {summary.hasActiveImpact && (
        <>
          <button className="mt-2 text-xs text-muted-foreground underline" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "hide detail" : "show detail"}
          </button>
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
    </div>
  );
}
