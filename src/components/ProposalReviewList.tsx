"use client";

/**
 * The Confirm step's UI — and the generic review surface every Proposal
 * kind (profile_field now, alert_rule/dashboard_panel/recommendation/pr
 * later) reuses. Approve / edit-then-approve / reject, never a silent
 * apply. Progressive disclosure: summary + rationale up front, full
 * evidence and payload behind a toggle.
 */
import { useEffect, useState } from "react";
import type { Proposal, ProposalKind } from "@/lib/models";

export function ProposalReviewList({ kind, title }: { kind: ProposalKind; title: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({});

  async function refresh() {
    const res = await fetch(`/api/proposals?kind=${kind}&status=pending`);
    const { proposals } = await res.json();
    setProposals(proposals);
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  async function decide(id: string, decision: "approved" | "rejected", editedPayload?: unknown) {
    await fetch(`/api/proposals/${id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, editedPayload }),
    });
    await refresh();
  }

  function approveWithEdit(p: Proposal) {
    const raw = editDrafts[p.id];
    if (!raw) return decide(p.id, "approved");
    try {
      const editedPayload = JSON.parse(raw);
      decide(p.id, "approved", editedPayload);
    } catch {
      alert("Edited payload isn't valid JSON — fix it or clear the edit box to approve as-is.");
    }
  }

  if (proposals.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">
        {title} <span className="text-muted-foreground">({proposals.length} pending)</span>
      </h2>
      <ul className="space-y-2">
        {proposals.map((p) => {
          const expanded = expandedId === p.id;
          return (
            <li key={p.id} className="rounded border border-border bg-card p-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{p.summary}</p>
                  <p className="mt-1 text-muted-foreground">{p.rationale}</p>
                </div>
                <button className="text-xs text-muted-foreground underline" onClick={() => setExpandedId(expanded ? null : p.id)}>
                  {expanded ? "hide detail" : "show detail"}
                </button>
              </div>
              {expanded && (
                <div className="mt-2 space-y-2">
                  {p.evidence.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.evidence.map((e, i) => (
                        <span key={i} className="evidence-chip" title={e.query}>
                          {e.type}: {e.summary}
                        </span>
                      ))}
                    </div>
                  )}
                  <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(p.payload, null, 2)}
                  </pre>
                  <textarea
                    className="w-full rounded border border-input bg-background p-2 text-xs font-mono"
                    rows={3}
                    placeholder="Optional: paste an edited payload (JSON) to edit-then-approve instead of approving as-is."
                    value={editDrafts[p.id] ?? ""}
                    onChange={(e) => setEditDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  />
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground"
                  onClick={() => approveWithEdit(p)}
                >
                  {editDrafts[p.id] ? "Save edit + approve" : "Approve"}
                </button>
                <button className="rounded border border-border px-3 py-1 text-xs" onClick={() => decide(p.id, "rejected")}>
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
