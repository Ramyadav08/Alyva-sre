"use client";

/**
 * Rung 6: "Writes it up, unprompted." Nobody clicks anything to get a
 * postmortem — it's already here by the time a human looks, generated
 * the instant recovery-check.ts confirmed a real recovery. Progressive
 * disclosure: headline only by default, full timeline/root-cause/
 * actions/long-term-fixes behind a toggle.
 */
import { useEffect, useState } from "react";
import type { Postmortem } from "@/lib/models";

export function PostmortemsPanel() {
  const [postmortems, setPostmortems] = useState<Postmortem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function refresh() {
      const res = await fetch("/api/postmortems");
      const { postmortems } = await res.json();
      setPostmortems(postmortems);
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  if (postmortems.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="section-heading">
        Postmortems <span className="text-muted-foreground">({postmortems.length})</span>
      </h2>
      <ul className="space-y-2">
        {postmortems.map((pm) => {
          const expanded = expandedId === pm.id;
          return (
            <li key={pm.id} className="surface-card">
              <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setExpandedId(expanded ? null : pm.id)}>
                <div>
                  <p className="font-medium">{pm.headline}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pm.serviceId} · {new Date(pm.createdAt).toLocaleString()}
                    {pm.businessImpactEstimateUsd !== null && ` · ~$${pm.businessImpactEstimateUsd} estimated impact`}
                  </p>
                </div>
              </button>
              {expanded && (
                <div className="mt-3 space-y-3 text-sm">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Timeline</p>
                    <ul className="mt-1 space-y-1">
                      {pm.timeline.map((t, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          <span className="font-mono">{new Date(t.at).toLocaleTimeString()}</span> — {t.event}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Root cause</p>
                    <p className="mt-1 text-muted-foreground">{pm.rootCause}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Actions taken</p>
                    <p className="mt-1 text-muted-foreground">{pm.actionsTaken}</p>
                  </div>
                  {pm.longTermFixes.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Long-term fixes</p>
                      <ul className="mt-1 list-inside list-disc text-muted-foreground">
                        {pm.longTermFixes.map((fix, i) => (
                          <li key={i}>{fix}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {pm.evidence.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {pm.evidence.map((e, i) => (
                        <span key={i} className="evidence-chip" title={e.query}>
                          {e.type}: {e.summary}
                        </span>
                      ))}
                    </div>
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
