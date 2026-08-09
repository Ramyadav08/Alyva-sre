"use client";

/**
 * Surfaces the plain-JS Detection & RCA skill's real output — the one
 * capability this dashboard doesn't have its own version of. Read-only
 * bridge (src/lib/js-skills-bridge.ts): reads data/investigations.json
 * directly, doesn't call into that system's process. Progressive
 * disclosure: headline + hypothesis up front, the full tool-use ledger
 * and skeptic review behind a toggle.
 *
 * Rebuilt on shadcn/ui (Card, Badge, Progress, Accordion) — same design
 * tokens throughout, no new brand. Unlike ProposalReviewList's pending
 * list, there are no action buttons here that need to stay visible while
 * collapsed (investigations are read-only), so this one uses a real Radix
 * Accordion for the whole list rather than manual expand state.
 *
 * Three UI upgrades on top of the original headline/hypothesis view
 * (inspiration: Cleric's confidence scoring, Resolve AI's impact-ranked
 * alerts, Traversal's evidence-linked findings — see docs):
 *  - `report.confidence` was plain text ("Confidence: high") — now a
 *    Progress bar (3 discrete levels mapped to fill %), since a visual
 *    confidence signal is exactly what Cleric's dashboard leads with.
 *  - `report.business_impact_note` already existed but had no bearing on
 *    ordering. Investigations with a real note (not the literal "unknown,
 *    awaiting input" placeholder the skill writes verbatim when it has no
 *    figure) now sort first and get a visible badge — a lightweight
 *    stand-in for Resolve's impact ranking; there's no numeric impact
 *    field in the underlying data to rank by more precisely than that.
 *  - `report.evidence_refs` and each ledger entry's `args`/`result`/
 *    `error` were already returned by /api/investigations (the bridge's
 *    real type is richer than the local type this component used to
 *    declare) but nothing rendered them beyond a flat tool-name string.
 *    evidence_refs now sit right next to the hypothesis as evidence
 *    chips (claim next to its proof, Traversal-style); the ledger trace
 *    is now one chip per step instead of a joined string.
 */
import { useEffect, useState } from "react";
import type { JsInvestigation } from "@/lib/js-skills-bridge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

const UNKNOWN_IMPACT = "unknown, awaiting input";

function hasRealImpact(note: string | undefined): boolean {
  return !!note && note.trim().toLowerCase() !== UNKNOWN_IMPACT;
}

const CONFIDENCE_LEVEL: Record<"high" | "medium" | "low", number> = { high: 3, medium: 2, low: 1 };

function ConfidenceMeter({ level }: { level: "high" | "medium" | "low" }) {
  const filled = CONFIDENCE_LEVEL[level] ?? 0;
  return (
    <div className="flex items-center gap-1.5" title={`Confidence: ${level}`}>
      <Progress value={(filled / 3) * 100} className="h-1.5 w-16" />
      <span className="text-xs text-muted-foreground">{level} confidence</span>
    </div>
  );
}

/** Short, safe-to-render summary of a ledger step's outcome, for the chip label. */
function summarizeStep(step: JsInvestigation["ledger"][number]): string {
  if (step.error) return `error: ${step.error}`.slice(0, 60);
  if (step.result === undefined) return "";
  const s = typeof step.result === "string" ? step.result : JSON.stringify(step.result);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export function InvestigationsPanel() {
  const [investigations, setInvestigations] = useState<JsInvestigation[] | null>(null);

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

  // Stable sort: investigations with a real business-impact figure lead: —
  // a lightweight stand-in for true impact ranking (see file header note).
  const sorted = investigations
    .map((inv, i) => ({ inv, i }))
    .sort((a, b) => {
      const rank = (x: JsInvestigation) => (hasRealImpact(x.report?.business_impact_note) ? 0 : 1);
      return rank(a.inv) - rank(b.inv) || a.i - b.i;
    })
    .map(({ inv }) => inv);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Investigations (Detection &amp; RCA)</CardTitle>
        <CardDescription>from the Detection skill</CardDescription>
      </CardHeader>
      {sorted.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          No active investigations right now — the Detection skill only opens one when an
          approved Alert Rule actually breaches live.
        </p>
      ) : (
        <Accordion type="single" collapsible className="border-t border-border px-4">
          {sorted.map((inv) => {
            const impactReal = hasRealImpact(inv.report?.business_impact_note);
            return (
              <AccordionItem key={inv.id} value={inv.id}>
                <AccordionTrigger>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {inv.report?.headline ?? `${inv.service_name} — ${inv.signal_type}`}
                      </span>
                      {impactReal && (
                        <Badge variant="warning" title={inv.report.business_impact_note}>
                          business impact noted
                        </Badge>
                      )}
                      <Badge variant={inv.status === "resolved" ? "success" : "warning"} className="ml-auto mr-2">
                        {inv.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm font-normal text-muted-foreground">{inv.report?.hypothesis}</p>
                    {inv.report?.evidence_refs?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {inv.report.evidence_refs.map((ref, i) => (
                          <span key={i} className="evidence-chip" title={ref}>
                            {ref.length > 48 ? `${ref.slice(0, 48)}…` : ref}
                          </span>
                        ))}
                      </div>
                    )}
                    {inv.report?.confidence && (
                      <div className="mt-1.5">
                        <ConfidenceMeter level={inv.report.confidence} />
                      </div>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 text-xs text-muted-foreground">
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
                    {inv.ledger?.length > 0 && (
                      <div>
                        <p className="mb-1 text-muted-foreground">Tool-use trace:</p>
                        <div className="flex flex-wrap items-center gap-1">
                          {inv.ledger.map((step, i) => (
                            <span key={i} className="flex items-center gap-1">
                              <span
                                className="evidence-chip"
                                title={JSON.stringify({ args: step.args, result: step.result, error: step.error }, null, 2)}
                              >
                                {step.tool}
                                {summarizeStep(step) && `: ${summarizeStep(step)}`}
                              </span>
                              {i < inv.ledger.length - 1 && <span aria-hidden>→</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </Card>
  );
}
