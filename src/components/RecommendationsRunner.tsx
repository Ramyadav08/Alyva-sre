"use client";

/** Fires unprompted on dashboard load, same Agency pattern as the other runners. */
import { useEffect, useState } from "react";

export function RecommendationsRunner() {
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/recommendations/run", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setSummary(d.error ? `Recommendations failed: ${d.error}` : `${d.count} new recommendation(s).`);
      })
      .catch((err) => !cancelled && setSummary(`Recommendations failed: ${err.message}`));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary) return null;
  return <p className="text-xs text-muted-foreground">{summary}</p>;
}
