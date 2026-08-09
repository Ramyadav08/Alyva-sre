"use client";

/**
 * The Confirm step's UI — and the generic review surface every Proposal
 * kind (profile_field now, alert_rule/dashboard_panel/recommendation/pr
 * later) reuses. Approve / edit-then-approve / reject, never a silent
 * apply. Progressive disclosure: summary + rationale up front, full
 * evidence and payload behind a toggle.
 *
 * Rebuilt on shadcn/ui (Card, Badge, Button, Input, Textarea, Accordion),
 * UI/UX inspiration from incident.io's inline accept/edit/reject and
 * Devin 2.0's timeline/checkpoint view (see docs) — same SREonCall brand
 * tokens, no new palette. All state/handlers below are unchanged from the
 * pre-shadcn version; only the returned markup changed. One deliberate
 * exception to "use Accordion everywhere": the *pending* list's
 * expand/collapse stays manual (not Radix Accordion) because Approve/
 * Reject must stay visible even while collapsed — Accordion's content
 * boundary would hide them too. The read-only "Recently decided" list has
 * no such constraint, so that one is a real Accordion.
 *
 *  - `history[]` was already on the Proposal model and captured every
 *    status transition, but nothing rendered it. It now shows as a small
 *    timeline — only when there's more than the one "pending" entry every
 *    proposal starts with, so a fresh proposal doesn't get timeline noise.
 *  - The edit step no longer forces a raw-JSON blob for every kind. Flat
 *    primitive fields (the common case — alert_rule's payload is entirely
 *    primitives) get a real before/after field editor; anything nested
 *    (profile_field's discovered/businessContext, etc.) still falls back
 *    to the original raw-JSON textarea behind an "Advanced" toggle, so no
 *    existing capability is lost for the kinds this simple editor can't
 *    safely represent.
 */
import { useEffect, useState } from "react";
import type { Proposal, ProposalKind, ProposalHistoryEntry, ProposalStatus } from "@/lib/models";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

type FieldValue = string | number | boolean | null;

const EDITABLE_TYPES = new Set(["string", "number", "boolean"]);

// The agent's own stated reasoning about the payload, not a tunable parameter of
// it — e.g. the alert-rules skill writes `rationale`/`confidence` inside the
// payload alongside real rule params like `threshold`. A human editing
// `threshold` is tuning a value; a human editing `rationale` would be silently
// rewriting the agent's own explanation of itself. Kept out of the editable
// field list and shown as read-only reasoning context instead — same
// distinction the Proposal envelope already draws for its own top-level
// `rationale` field, just extended to payload-embedded reasoning too.
const REASONING_KEYS = new Set(["rationale", "confidence"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Top-level keys whose value is a primitive we can safely edit as a single field. */
function getEditableFields(payload: unknown): Array<{ key: string; value: FieldValue }> {
  if (!isPlainObject(payload)) return [];
  return Object.entries(payload)
    .filter(([k, v]) => !REASONING_KEYS.has(k) && (v === null || EDITABLE_TYPES.has(typeof v)))
    .map(([key, value]) => ({ key, value: value as FieldValue }));
}

/** The agent's own reasoning about this payload — read-only, never inline-editable. */
function getReasoningFields(payload: unknown): Array<{ key: string; value: FieldValue }> {
  if (!isPlainObject(payload)) return [];
  return Object.entries(payload)
    .filter(([k, v]) => REASONING_KEYS.has(k) && (v === null || EDITABLE_TYPES.has(typeof v)))
    .map(([key, value]) => ({ key, value: value as FieldValue }));
}

/** Everything NOT covered by getEditableFields/getReasoningFields — shown read-only, not editable here. */
function getReadonlyFields(payload: unknown): Array<{ key: string; value: unknown }> {
  if (!isPlainObject(payload)) return [];
  return Object.entries(payload)
    .filter(([, v]) => !(v === null || EDITABLE_TYPES.has(typeof v)))
    .map(([key, value]) => ({ key, value }));
}

function coerce(raw: string, original: FieldValue): FieldValue {
  if (typeof original === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? original : n;
  }
  if (typeof original === "boolean") return raw === "true";
  return raw;
}

const STATUS_BADGE_VARIANT: Record<ProposalStatus, BadgeProps["variant"]> = {
  pending: "neutral",
  edited: "ai",
  approved: "success",
  rejected: "error",
  applied: "primary",
  apply_failed: "error",
};

const STATUS_LABEL: Record<ProposalStatus, string> = {
  pending: "Proposed",
  edited: "Edited",
  approved: "Approved",
  rejected: "Rejected",
  applied: "Applied",
  apply_failed: "Apply failed",
};

// Plain span, not Badge, for this one — it's a decorative absolutely-positioned
// dot, not a status pill, and Badge's own variant padding classes aren't
// guaranteed to lose to an override here (cva concatenates rather than
// tailwind-merges its className slot).
const TIMELINE_DOT_CLASS: Record<ProposalStatus, string> = {
  pending: "border-muted-foreground/50 bg-muted",
  edited: "border-ai bg-ai/10",
  approved: "border-success bg-success/10",
  rejected: "border-error bg-error/10",
  applied: "border-primary bg-primary/10",
  apply_failed: "border-error bg-error/10",
};

function HistoryTimeline({ history }: { history: ProposalHistoryEntry[] }) {
  return (
    <ol className="space-y-2 border-l border-border pl-3">
      {history.map((h, i) => (
        <li key={i} className="relative text-xs">
          <span
            className={`absolute -left-[15px] top-0.5 h-2.5 w-2.5 rounded-full border-2 ${TIMELINE_DOT_CLASS[h.status]}`}
            aria-hidden
          />
          <span className="font-medium text-foreground">{STATUS_LABEL[h.status]}</span>
          <span className="ml-2 text-muted-foreground">{new Date(h.at).toLocaleString()}</span>
          {h.note && <p className="mt-0.5 text-muted-foreground">{h.note}</p>}
        </li>
      ))}
    </ol>
  );
}

export function ProposalReviewList({ kind, title }: { kind: ProposalKind; title: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fieldEdits, setFieldEdits] = useState<Record<string, Record<string, string>>>({});
  const [rawEdits, setRawEdits] = useState<Record<string, string>>({});
  const [advancedId, setAdvancedId] = useState<string | null>(null);
  // Read-only — the pending list above is the only place a decision gets made.
  // Exists so the history timeline has somewhere real to appear: a `pending`
  // proposal can only ever have 1 history entry by construction (see
  // proposals.ts), so decided ones are the only reachable case for it.
  const [decided, setDecided] = useState<Proposal[]>([]);

  async function refresh() {
    const res = await fetch(`/api/proposals?kind=${kind}&status=pending`);
    const { proposals } = await res.json();
    setProposals(proposals);
  }

  async function refreshDecided() {
    const res = await fetch(`/api/proposals?kind=${kind}&status=decided`);
    const { proposals } = await res.json();
    const sorted = [...proposals].sort(
      (a: Proposal, b: Proposal) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    setDecided(sorted.slice(0, 5));
  }

  useEffect(() => {
    refresh();
    refreshDecided();
    const interval = setInterval(() => {
      refresh();
      refreshDecided();
    }, 5000);
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
    await refreshDecided();
  }

  function approveWithEdit(p: Proposal) {
    // Advanced (raw JSON) takes precedence when the reviewer opted into it.
    const raw = rawEdits[p.id];
    if (advancedId === p.id && raw) {
      try {
        return decide(p.id, "approved", JSON.parse(raw));
      } catch {
        alert("Edited payload isn't valid JSON — fix it or clear the box to approve as-is.");
        return;
      }
    }

    const edits = fieldEdits[p.id];
    if (!edits || Object.keys(edits).length === 0) return decide(p.id, "approved");

    const editable = getEditableFields(p.payload);
    const base = isPlainObject(p.payload) ? { ...p.payload } : {};
    for (const [key, rawVal] of Object.entries(edits)) {
      const field = editable.find((f) => f.key === key);
      base[key] = field ? coerce(rawVal, field.value) : rawVal;
    }
    decide(p.id, "approved", base);
  }

  function hasEdits(id: string): boolean {
    if (advancedId === id && rawEdits[id]) return true;
    const edits = fieldEdits[id];
    return !!edits && Object.values(edits).some((v) => v !== undefined);
  }

  if (proposals.length === 0 && decided.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">
        {title} <span className="text-muted-foreground">({proposals.length} pending)</span>
      </h2>
      <div className="space-y-2">
        {proposals.map((p) => {
          const expanded = expandedId === p.id;
          const editable = getEditableFields(p.payload);
          const readonly = getReadonlyFields(p.payload);
          const reasoning = getReasoningFields(p.payload);
          return (
            <Card key={p.id}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{p.summary}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{p.rationale}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto shrink-0 p-0 text-xs underline"
                    onClick={() => setExpandedId(expanded ? null : p.id)}
                  >
                    {expanded ? "hide detail" : "show detail"}
                  </Button>
                </div>
                {expanded && (
                  <div className="mt-3 space-y-3">
                    {p.evidence.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {p.evidence.map((e, i) => (
                          <span key={i} className="evidence-chip" title={e.query}>
                            {e.type}: {e.summary}
                          </span>
                        ))}
                      </div>
                    )}

                    {p.history.length > 1 && (
                      <div>
                        <p className="mb-1.5 text-xs font-medium text-muted-foreground">History</p>
                        <HistoryTimeline history={p.history} />
                      </div>
                    )}

                    {reasoning.length > 0 && (
                      <div className="space-y-1 rounded border border-ai/30 bg-ai/5 p-2">
                        <p className="text-xs font-medium text-ai">
                          Agent&rsquo;s reasoning (not editable — reject or leave a note instead)
                        </p>
                        {reasoning.map((f) => (
                          <p key={f.key} className="text-xs text-muted-foreground">
                            <span className="font-medium">{f.key}:</span> {String(f.value)}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="space-y-1.5 rounded border border-border p-2">
                      {editable.length > 0 ? (
                        editable.map((f) => (
                          <div key={f.key} className="flex items-center gap-2 text-xs">
                            <span className="w-40 shrink-0 text-muted-foreground">{f.key}</span>
                            <Input
                              className="h-7 flex-1 font-mono text-xs"
                              defaultValue={String(f.value)}
                              placeholder={String(f.value)}
                              onChange={(e) =>
                                setFieldEdits((all) => ({
                                  ...all,
                                  [p.id]: { ...all[p.id], [f.key]: e.target.value },
                                }))
                              }
                            />
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No flat fields to edit inline for this proposal kind — use Advanced below.
                        </p>
                      )}
                      {readonly.length > 0 && (
                        <p className="pt-1 text-xs text-muted-foreground">
                          {readonly.map((f) => f.key).join(", ")} — nested, not editable inline (use Advanced).
                        </p>
                      )}
                    </div>

                    <div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0 text-xs underline"
                        onClick={() => setAdvancedId(advancedId === p.id ? null : p.id)}
                      >
                        {advancedId === p.id ? "hide advanced (raw JSON)" : "advanced: edit raw JSON instead"}
                      </Button>
                      {advancedId === p.id && (
                        <div className="mt-1.5 space-y-1.5">
                          <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
                            {JSON.stringify(p.payload, null, 2)}
                          </pre>
                          <Textarea
                            className="text-xs font-mono"
                            rows={3}
                            placeholder="Paste a full replacement payload (JSON) — overrides the field edits above."
                            value={rawEdits[p.id] ?? ""}
                            onChange={(e) => setRawEdits((d) => ({ ...d, [p.id]: e.target.value }))}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => approveWithEdit(p)}>
                    {hasEdits(p.id) ? "Save edit + approve" : "Approve"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => decide(p.id, "rejected")}>
                    Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {decided.length > 0 && (
        <div className="pt-1">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Recently decided ({decided.length})</p>
          <Accordion type="single" collapsible className="rounded-md border border-border bg-card/50 px-3">
            {decided.map((p) => (
              <AccordionItem key={p.id} value={p.id}>
                <AccordionTrigger className="text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge variant={STATUS_BADGE_VARIANT[p.status]} className="shrink-0">
                      {STATUS_LABEL[p.status]}
                    </Badge>
                    <span className="truncate font-normal text-foreground">{p.summary}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    <HistoryTimeline history={p.history} />
                    {p.evidence.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {p.evidence.map((e, i) => (
                          <span key={i} className="evidence-chip" title={e.query}>
                            {e.type}: {e.summary}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      )}
    </section>
  );
}
