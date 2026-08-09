"use client";

/**
 * The other half of Rung 5 ("Fixes it, with you in the loop" — propose →
 * approve/modify/reject → execute → verified recovery): applied
 * recommendation/pr Proposals and whether the thing they claimed to fix
 * actually got better, not just "applied and forgotten." Progressive
 * disclosure: verdict badge up front, before/after evidence on demand.
 */
import { useEffect, useState } from "react";
import type { Proposal } from "@/lib/models";

const VERDICT_STYLE: Record<string, string> = {
  recovered: "bg-success/10 text-success",
  not_recovered: "bg-error/10 text-error",
  inconclusive: "bg-muted text-muted-foreground",
};

export function AppliedFixesPanel() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function refresh() {
      const [recRes, prRes] = await Promise.all([
        fetch("/api/proposals?kind=recommendation&status=applied"),
        fetch("/api/proposals?kind=pr&status=applied"),
      ]);
      const [rec, pr] = await Promise.all([recRes.json(), prRes.json()]);
      setProposals([...(rec.proposals ?? []), ...(pr.proposals ?? [])]);
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  if (proposals.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="section-heading">
        Applied fixes <span className="text-muted-foreground">({proposals.length})</span>
      </h2>
      <ul className="space-y-2">
        {proposals.map((p) => {
          const expanded = expandedId === p.id;
          const verdict = p.recoveryCheck?.verdict;
          return (
            <li key={p.id} className="rounded border border-border bg-card p-3 text-sm">
              <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setExpandedId(expanded ? null : p.id)}>
                <span>
                  <span className="font-medium">{p.summary}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{p.serviceId}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${verdict ? VERDICT_STYLE[verdict] : "bg-muted text-muted-foreground"}`}>
                  {verdict ? verdict.replace(/_/g, " ") : "checking soon…"}
                </span>
              </button>
              {expanded && (
                <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                  <p>{p.rationale}</p>
                  {p.recoveryCheck && (
                    <>
                      <p>{p.recoveryCheck.note}</p>
                      <div className="flex flex-wrap gap-1">
                        <span className="evidence-chip">before: {p.recoveryCheck.beforeEvidence[0]?.summary ?? "n/a"}</span>
                        <span className="evidence-chip">after: {p.recoveryCheck.afterEvidence[0]?.summary ?? "n/a"}</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
