"use client";

/**
 * Progressive disclosure over the ServiceProfile store: a one-line status
 * per service (onboarded vs. still being discovered/interviewed), not the
 * full discovered+businessContext payload dumped inline.
 */
import { useEffect, useState } from "react";
import type { ServiceProfile } from "@/lib/models";

export function OnboardedServices() {
  const [profiles, setProfiles] = useState<ServiceProfile[]>([]);

  useEffect(() => {
    async function refresh() {
      const res = await fetch("/api/onboarding/profiles");
      const { profiles } = await res.json();
      setProfiles(profiles);
    }
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  if (profiles.length === 0) return null;

  const onboarded = profiles.filter((p) => p.onboarded);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">
        Services <span className="text-muted-foreground">({onboarded.length}/{profiles.length} onboarded)</span>
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {profiles.map((p) => (
          <li
            key={p.serviceId}
            className="flex items-center justify-between rounded border border-border bg-card px-3 py-2 text-sm"
          >
            <span className="font-mono">{p.displayName}</span>
            <span
              className={`text-xs ${p.onboarded ? "text-success" : "text-muted-foreground"}`}
              title={p.onboarded ? `tier: ${p.businessContext.tier}` : "awaiting confirm"}
            >
              {p.onboarded ? "onboarded" : "in progress"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
