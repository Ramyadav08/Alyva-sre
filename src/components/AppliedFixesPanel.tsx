"use client";

/**
 * The other half of Rung 5 ("Fixes it, with you in the loop" — propose →
 * approve/modify/reject → execute → verified recovery): applied
 * recommendation/pr Proposals and whether the thing they claimed to fix
 * actually got better, not just "applied and forgotten." Progressive
 * disclosure: verdict badge up front, before/after evidence on demand.
 * Rebuilt on shadcn/ui: Accordion for the list (no action buttons live
 * below the toggle), Badge for the recovery verdict.
 */
import { useEffect, useState } from "react";
import type { Proposal } from "@/lib/models";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

const VERDICT_VARIANT: Record<string, BadgeProps["variant"]> = {
  recovered: "success",
  not_recovered: "error",
  inconclusive: "neutral",
};

export function AppliedFixesPanel() {
  const [proposals, setProposals] = useState<Proposal[]>([]);

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
      <Accordion type="single" collapsible className="rounded-md border border-border bg-card px-3">
        {proposals.map((p) => {
          const verdict = p.recoveryCheck?.verdict;
          return (
            <AccordionItem key={p.id} value={p.id}>
              <AccordionTrigger className="text-sm">
                <span className="flex flex-1 items-start justify-between gap-3">
                  <span>
                    <span className="font-medium">{p.summary}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{p.serviceId}</span>
                  </span>
                  <Badge variant={verdict ? VERDICT_VARIANT[verdict] : "neutral"} className="shrink-0">
                    {verdict ? verdict.replace(/_/g, " ") : "checking soon…"}
                  </Badge>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 text-xs text-muted-foreground">
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
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </section>
  );
}
