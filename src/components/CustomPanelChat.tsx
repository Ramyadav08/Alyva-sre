"use client";

/**
 * "Ask" bar for custom panels — Perplexity/Linear-style single-line
 * command input (the Harvey/Legora-inspired layout language: one
 * confident input, generous whitespace, pill actions), not a form.
 * Drafts against real data, previews live, only persists on "Keep."
 * Rebuilt on shadcn/ui for the draft preview (Card, Button, Progress for
 * ranking-shaped previews) — the `.ask-bar` input itself is left as a
 * plain `<input>`: it's a deliberate transparent/borderless design
 * already matching the Perplexity/Linear reference, and dropping the
 * bordered shadcn Input into it would fight that look rather than fit it.
 */
import { useState } from "react";
import type { Proposal } from "@/lib/models";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export function CustomPanelChat({ onKept }: { onKept?: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<Proposal | null>(null);
  const [status, setStatus] = useState<"idle" | "drafting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!prompt.trim()) return;
    setStatus("drafting");
    setError(null);
    try {
      const res = await fetch("/api/dashboard/custom-panel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "couldn't draft a panel");
      setDraft(data.proposal);
      setStatus("idle");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  async function decide(decision: "approved" | "rejected") {
    if (!draft) return;
    await fetch(`/api/proposals/${draft.id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setDraft(null);
    setPrompt("");
    if (decision === "approved") onKept?.();
  }

  return (
    <div className="space-y-3">
      <div className="ask-bar">
        <input
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder='Ask for a panel — e.g. "show me the top services by latency between service and call request"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <Button size="sm" className="shrink-0" onClick={submit} disabled={status === "drafting" || !prompt.trim()}>
          {status === "drafting" ? "Drafting…" : "Ask"}
        </Button>
      </div>
      {error && <p className="text-xs text-error">{error}</p>}

      {draft && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div>
              <p className="section-heading">{draft.summary}</p>
              <p className="mt-1 text-sm text-muted-foreground">{draft.rationale}</p>
            </div>
            <CustomPanelPreview payload={draft.payload as any} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => decide("approved")}>
                Keep on my dashboard
              </Button>
              <Button variant="secondary" size="sm" onClick={() => decide("rejected")}>
                Discard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CustomPanelPreview({ payload }: { payload: { title: string; previewData: unknown } }) {
  const data = payload.previewData;
  if (!Array.isArray(data) || data.length === 0) {
    return <p className="text-xs text-muted-foreground">No live data returned for this preview yet.</p>;
  }

  // Ranking-shaped preview: [{label, value, unit}]
  if (typeof data[0] === "object" && "label" in (data[0] as any)) {
    const rows = data as Array<{ label: string; value: number; unit: string }>;
    const max = Math.max(...rows.map((r) => r.value));
    return (
      <ul className="space-y-1">
        {rows.slice(0, 8).map((r, i) => (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className="w-40 truncate font-mono text-xs">{r.label}</span>
            <Progress value={(r.value / max) * 100} className="h-2 flex-1" />
            <span className="w-16 text-right font-mono text-xs">
              {r.value.toFixed(1)}{r.unit}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  // Series-shaped preview: [{ts, value}]
  const points = data as Array<{ ts: number; value: number }>;
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <div className="flex h-12 items-end gap-0.5">
      {points.slice(-40).map((p, i) => (
        <div key={i} className="flex-1 rounded-t bg-brand/70" style={{ height: `${Math.max(4, (p.value / max) * 100)}%` }} />
      ))}
    </div>
  );
}
