"use client";

/**
 * Active alert rules and their most recent backtest verdict —
 * progressive disclosure: a one-line status per rule, full tuning
 * history behind a toggle. This is the visible proof that "self-
 * correcting" is a real, ongoing thing, not a one-time draft.
 * Rebuilt on shadcn/ui: Accordion for the list (no action buttons live
 * below the toggle, so a real Accordion fits cleanly), Badge for the
 * verdict pill.
 */
import { useEffect, useState } from "react";
import type { AlertPolicy, AlertRule } from "@/lib/models";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

const VERDICT_VARIANT: Record<string, BadgeProps["variant"]> = {
  acceptable: "success",
  never_fired_in_window: "success",
  frequent_but_corroborated: "warning",
  likely_noisy: "error",
  untestable: "neutral",
  no_historical_data: "neutral",
  query_failed: "neutral",
};

export function ActiveRulesList() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [policies, setPolicies] = useState<AlertPolicy[]>([]);

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
      <Accordion type="single" collapsible className="rounded-md border border-border bg-card px-3">
        {active.map((r) => (
          <AccordionItem key={r.id} value={r.id}>
            <AccordionTrigger className="text-sm">
              <span className="flex flex-1 items-center justify-between gap-3">
                <span>
                  <span className="font-mono">{r.serviceId}</span>
                  <span className="ml-2 font-normal text-muted-foreground">
                    {r.signalType} {r.operator} {r.threshold.toFixed(2)}
                    {r.thresholdUnit} / {r.windowMinutes}m
                  </span>
                </span>
                {r.lastBacktest && (
                  <Badge variant={VERDICT_VARIANT[r.lastBacktest.verdict] ?? "neutral"} className="shrink-0">
                    {r.lastBacktest.verdict.replace(/_/g, " ")}
                  </Badge>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1 text-xs text-muted-foreground">
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
                    {r.appliedPolicyIds.map((id) => policies.find((p) => p.id === id)?.text ?? id).join("; ")}
                  </p>
                )}
                {(r.lastBacktest?.excludedByQuietHoursCount ?? 0) > 0 && (
                  <p>{r.lastBacktest!.excludedByQuietHoursCount} sample(s) excluded from the last backtest by quiet hours</p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
