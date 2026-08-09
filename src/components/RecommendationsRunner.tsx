"use client";

/** Fires unprompted on dashboard load, same Agency pattern as the other runners. */
import { useEffect, useState } from "react";
import { RunnerStatus, type RunnerState } from "./RunnerStatus";

export function RecommendationsRunner() {
  const [status, setStatus] = useState<RunnerState>("running");
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/recommendations/run", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) {
          setSummary(`Recommendations failed: ${d.error}`);
          setStatus("error");
        } else {
          setSummary(`${d.count} new recommendation(s).`);
          setStatus("done");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSummary(`Recommendations failed: ${err.message}`);
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const label = status === "running" ? "Generating recommendations from live traffic patterns…" : summary;
  return <RunnerStatus state={status} label={label} />;
}
