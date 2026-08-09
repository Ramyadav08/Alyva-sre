"use client";

/** Fires unprompted on dashboard load — Agency, same pattern as the other runners. */
import { useEffect, useState } from "react";
import { RunnerStatus, type RunnerState } from "./RunnerStatus";

export function RecoveryCheckRunner() {
  const [status, setStatus] = useState<RunnerState>("running");
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/recovery-check/run", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) {
          setSummary(`Recovery check failed: ${d.error}`);
          setStatus("error");
        } else {
          setSummary(`${d.checked} recovery check(s), ${d.postmortemsWritten} postmortem(s) written.`);
          setStatus("done");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSummary(`Recovery check failed: ${err.message}`);
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const label = status === "running" ? "Checking on previously-applied fixes…" : summary;
  return <RunnerStatus state={status} label={label} />;
}
