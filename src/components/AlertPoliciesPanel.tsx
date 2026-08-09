"use client";

/**
 * Stretch 8: plain-English policy acceptance for alerting.
 *
 * Same ask-bar language as CustomPanelChat — one confident input, no form.
 * Unlike a CustomPanelChat draft, there's nothing to preview-then-keep
 * here: the human's own words ARE the policy, verbatim, the instant they
 * submit. Malleability lives in the toggle, not an edit box — turning a
 * policy off takes effect on the very next unprompted alert-rules cycle
 * (AlertRulesRunner), same as adding a new one.
 *
 * Progressive disclosure: policies render as a flat one-line list (they're
 * already short, plain English by design) — no drill-down needed. The
 * concrete effect on real rules shows up in ActiveRulesList/
 * ProposalReviewList, not here — this panel is just where the house rules
 * themselves live.
 */
import { useEffect, useState } from "react";
import type { AlertPolicy } from "@/lib/models";

export function AlertPoliciesPanel() {
  const [policies, setPolicies] = useState<AlertPolicy[]>([]);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/alert-policies");
    const { policies } = await res.json();
    setPolicies(policies);
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  async function submit() {
    if (!text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/alert-policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "couldn't save policy");
      setText("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(policy: AlertPolicy) {
    await fetch(`/api/alert-policies/${policy.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !policy.active }),
    });
    await refresh();
  }

  return (
    <section className="space-y-3">
      <h2 className="section-heading">Alerting house rules</h2>
      <p className="text-xs text-muted-foreground">
        Tell Alyva how alerting should behave, in plain English — it's consulted on every rule draft and re-checked
        against every already-active rule, unprompted.
      </p>
      <div className="ask-bar">
        <input
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder={'e.g. "don\'t page before 9am unless it\'s payments"'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button className="btn-pill-primary shrink-0 px-4 py-1.5 text-xs disabled:opacity-40" onClick={submit} disabled={submitting || !text.trim()}>
          {submitting ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
      {policies.length > 0 && (
        <ul className="space-y-1">
          {policies.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 rounded border border-border bg-card px-3 py-2 text-sm">
              <span className={p.active ? "" : "text-muted-foreground line-through"}>{p.text}</span>
              <button className="text-xs text-muted-foreground underline" onClick={() => toggle(p)}>
                {p.active ? "deactivate" : "reactivate"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
