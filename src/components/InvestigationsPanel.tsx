"use client";

/**
 * Surfaces the plain-JS Detection & RCA skill's real output — the one
 * capability this dashboard doesn't have its own version of. Read-only
 * bridge (src/lib/js-skills-bridge.ts): reads data/investigations.json
 * directly, doesn't call into that system's process. Progressive
 * disclosure: headline + hypothesis up front, the full tool-use ledger
 * and skeptic review behind a toggle.
 */
import { useEffect, useState } from "react";

type Investigation = {
  id: string;
  service_name: string;
  signal_type: string;
  triggered_at: string;
  status: "reported" | "resolved";
  report: {
    headline: string;
    hypothesis: string;
    confidence: string;
    business_impact_note: string;
    next_steps: string[];
    code_fix_suggested: boolean;
  };
  ledger: Array<{ tool: string; at: string }>;
  skeptic_review: { contradicts_investigator: boolean; objection?: string } | null;
};

export function InvestigationsPanel() {
  const [investigations, setInvestigations] = useState<Investigation[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function refresh() {
      const res = await fetch("/api/investigations");
      const { investigations } = await res.json();
      setInvestigations(investigations);
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  if (investigations === null) return null;

  return (
    <div className="surface-card">
      <div className="flex items-center justify-between">
        <h2 className="section-heading">Investigations (Detection &amp; RCA)</h2>
        <span className="text-xs text-muted-foreground">from the Detection skill</span>
      </div>
      {investigations.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No active investigations right now — the Detection skill only opens one when an
          approved Alert Rule actually breaches live.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {investigations.map((inv) => {
            const expanded = expandedId === inv.id;
            return (
              <li key={inv.id} className="rounded border border-border p-3 text-sm">
                <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setExpandedId(expanded ? null : inv.id)}>
                  <div>
                    <p className="font-medium">{inv.report?.headline ?? `${inv.service_name} — ${inv.signal_type}`}</p>
                    <p className="mt-1 text-muted-foreground">{inv.report?.hypothesis}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${inv.status === "resolved" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                    {inv.status}
                  </span>
                </button>
                {expanded && (
                  <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                    <p>Confidence: {inv.report?.confidence}</p>
                    {inv.report?.business_impact_note && <p>Business impact: {inv.report.business_impact_note}</p>}
                    {inv.report?.next_steps?.length > 0 && (
                      <ul className="list-inside list-disc">
                        {inv.report.next_steps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ul>
                    )}
                    {inv.skeptic_review?.contradicts_investigator && (
                      <p className="text-warning">Skeptic objection: {inv.skeptic_review.objection}</p>
                    )}
                    <p>Tool-use ledger: {inv.ledger?.map((l) => l.tool).join(" → ") || "(none)"}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
