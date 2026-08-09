"use client";

/**
 * Fires the onboarding cycle the moment the dashboard loads — no button,
 * no "Generate" click. This is the concrete Agency behavior: discovery and
 * the interview step happen because the page opened, not because a human
 * asked for them.
 */
import { useEffect, useState } from "react";
import { RunnerStatus, type RunnerState } from "./RunnerStatus";

type Status = RunnerState;

export function OnboardingRunner({ onDone }: { onDone?: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setStatus("running");
      try {
        const res = await fetch("/api/onboarding/run", { method: "POST" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "onboarding run failed");
        const asked = data.interview.filter((r: any) => r.action === "asked").length;
        const finalized = data.interview.filter((r: any) => r.action === "finalized").length;
        setSummary(
          `Discovered ${data.discovery.totalServices} service(s) (${data.discovery.discoveredCount} new). ` +
            `${asked} question(s) asked, ${finalized} profile(s) drafted for review.`,
        );
        setStatus("done");
        onDone?.();
      } catch (err) {
        if (!cancelled) {
          setSummary((err as Error).message);
          setStatus("error");
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label =
    status === "running"
      ? "Discovering services from live telemetry…"
      : status === "error"
        ? `Onboarding run failed: ${summary}`
        : summary;

  return <RunnerStatus state={status} label={label} />;
}
