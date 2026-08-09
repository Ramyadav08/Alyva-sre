"use client";

/** Fires unprompted on dashboard load — Agency, same pattern as the other runners. */
import { useEffect, useState } from "react";

export function RecoveryCheckRunner() {
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/recovery-check/run", { method: "POST" })
      .then((r) => r.json())
      .then(
        (d) =>
          !cancelled &&
          setSummary(d.error ? `Recovery check failed: ${d.error}` : `${d.checked} recovery check(s), ${d.postmortemsWritten} postmortem(s) written.`),
      )
      .catch((err) => !cancelled && setSummary(`Recovery check failed: ${err.message}`));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary) return null;
  return <p className="text-xs text-muted-foreground">{summary}</p>;
}
