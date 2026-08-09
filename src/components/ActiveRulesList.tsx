"use client";

/**
 * Active alert rules and their most recent backtest verdict —
 * progressive disclosure: a one-line status per rule, full tuning
 * history behind a toggle. This is the visible proof that "self-
 * correcting" is a real, ongoing thing, not a one-time draft.
 */
import { useEffect, useState } from "react";
import type { AlertPolicy, AlertRule } from "@/lib/models";

const VERDICT_STYLE: Record<string, string> = {
  acceptable: "text-success",
  never_fired_in_window: "text-success",
  frequent_but_corroborated: "text-warning",
  likely_noisy: "text-error",
  untestable: "text-muted-foreground",
  no_historical_data: "text-muted-foreground",
  query_failed: "text-muted-foreground",
};

export function ActiveRulesList() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [policies, setPolicies] = useState<AlertPolicy[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function refresh() {
      const [rulesRes, policiesRes] = await Promise.all([fetch("/api/alert-rules"), fetch("/api/alert-policies")]);
      const { rules } = await rulesRes.json();
      const { policies } = await policiesRes.json();
      setRules(rules);
      setPolicies(policies);
    }
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, []);

  const active = rules.filter((r) => r.status === "active");
  if (active.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">
        Active alert rules <span className="text-muted-foreground">({active.length})</span>
      </h2>
      <ul className="space-y-2">
        {active.map((r) => {
          const expanded = expandedId === r.id;
          return (
            <li key={r.id} className="rounded border border-border bg-card p-2 text-sm">
              <button className="flex w-full items-center justify-between text-left" onClick={() => setExpandedId(expanded ? null : r.id)}>
                <span>
                  <span className="font-mono">{r.serviceId}</span>
                  <span className="ml-2 text-muted-foreground">
                    {r.signalType} {r.operator} {r.threshold.toFixed(2)}{r.thresholdUnit} / {r.windowMinutes}m
                  </span>
                </span>
                {r.lastBacktest && (
                  <span className={`text-xs ${VERDICT_STYLE[r.lastBacktest.verdict] ?? "text-muted-foreground"}`}>
                    {r.lastBacktest.verdict.replace(/_/g, " ")}
                  </span>
                )}
              </button>
              {expanded && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p>{r.rationale}</p>
                  {r.tuningHistory.length > 0 && (
                    <p>
                      Self-tuned {r.tuningHistory.length}x:{" "}
                      {r.tuningHistory.map((h) => `${h.beforeThreshold.toFixed(1)}→${h.afterThreshold.toFixed(1)}`).join(", ")}
                    </p>
                  )}
                  {r.quietHours && (
                    <p>Quiet hours: {r.quietHours.startHour}:00–{r.quietHours.endHour}:00 (excluded from firing/noise checks)</p>
                  )}
                  {r.appliedPolicyIds?.length > 0 && (
                    <p>
                      House rules consulted:{" "}
                      {r.appliedPolicyIds
                        .map((id) => policies.find((p) => p.id === id)?.text ?? id)
                        .join("; ")}
                    </p>
                  )}
                  {(r.lastBacktest?.excludedByQuietHoursCount ?? 0) > 0 && (
                    <p>{r.lastBacktest!.excludedByQuietHoursCount} sample(s) excluded from the last backtest by quiet hours</p>
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
