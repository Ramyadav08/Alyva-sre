"use client";

/**
 * Fires both the drafting cycle and the retune sweep on dashboard load —
 * unprompted, same Agency pattern as OnboardingRunner. The retune sweep
 * is what makes this "self-correcting": it re-checks every active rule's
 * own recent firing history against real evidence every time the
 * dashboard loads, without anyone asking it to.
 */
import { useEffect, useState } from "react";
import { RunnerStatus, type RunnerState } from "./RunnerStatus";

export function AlertRulesRunner() {
  const [status, setStatus] = useState<RunnerState>("running");
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const draftRes = await fetch("/api/alert-rules/run", { method: "POST" });
        const draft = await draftRes.json();
        const retuneRes = await fetch("/api/alert-rules/retune-sweep", { method: "POST" });
        const retune = await retuneRes.json();
        if (cancelled) return;
        const proposed = (draft.drafted ?? []).filter((d: any) => d.action === "proposed").length;
        const retuned = (retune.results ?? []).filter((r: any) => r.action === "retune_proposed").length;
        setSummary(`${proposed} rule(s) drafted, ${retuned} retune proposal(s) from this pass.`);
        setStatus("done");
      } catch (err) {
        if (!cancelled) {
          setSummary(`Alert-rules cycle failed: ${(err as Error).message}`);
          setStatus("error");
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const label = status === "running" ? "Drafting alert rules and retuning existing ones…" : summary;
  return <RunnerStatus state={status} label={label} />;
}
