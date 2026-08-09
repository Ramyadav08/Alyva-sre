/**
 * Business Impact panel's data source. Deliberately live-computed on every
 * call, never a stored/static number — per the plan: "computed from
 * Milestone 1 profile × Milestone 2's live alert state."
 *
 * Milestone 2 doesn't exist yet at the time this was first written, so
 * "active impact" is judged here from a live health check against each
 * service's own discovered baseline (still real telemetry, still
 * evidence-cited) — once real AlertRule firing history exists, prefer
 * that instead (a rule firing is a stronger, human-reviewed signal than
 * this heuristic). See onboarding.ts's discoverServices for how the
 * baseline itself gets set.
 */
import { getServiceHealth } from "./lgtm";
import { getDb } from "./store";
import type { EvidenceRef, ServiceProfile } from "./models";

export type ImpactedService = {
  serviceId: string;
  tier: ServiceProfile["businessContext"]["tier"];
  estimatedUsdPerMinute: number | null;
  evidence: EvidenceRef[];
};

export type BusinessImpactSummary = {
  hasActiveImpact: boolean;
  totalEstimatedUsdPerMinute: number;
  impactedServices: ImpactedService[];
  checkedServiceCount: number;
};

const ERROR_RATE_DELTA_THRESHOLD = 5; // percentage points above baseline
const ERROR_RATE_ABSOLUTE_FLOOR = 10; // percent, used when no baseline exists yet

export async function computeActiveBusinessImpact(): Promise<BusinessImpactSummary> {
  const db = await getDb();
  const revenueBearing = db.data.serviceProfiles.filter(
    (p) => p.onboarded && (p.businessContext.tier === "revenue_critical" || p.businessContext.tier === "customer_facing"),
  );

  const impacted: ImpactedService[] = [];

  for (const profile of revenueBearing) {
    const live = await getServiceHealth(profile.serviceId);
    if (live.errorRatePercent === null) continue;

    const baseline = profile.discovered.errorRatePercent;
    const threshold = baseline !== null ? baseline + ERROR_RATE_DELTA_THRESHOLD : ERROR_RATE_ABSOLUTE_FLOOR;
    if (live.errorRatePercent <= threshold) continue;

    const now = new Date().toISOString();
    impacted.push({
      serviceId: profile.serviceId,
      tier: profile.businessContext.tier,
      estimatedUsdPerMinute: profile.businessContext.revenuePerIncidentMinuteUsd,
      evidence: [
        {
          type: "metric",
          query: `error-rate ratio for service_name="${profile.serviceId}"`,
          summary:
            `live error rate ${live.errorRatePercent.toFixed(1)}% vs baseline ` +
            `${baseline !== null ? baseline.toFixed(1) + "%" : `<${ERROR_RATE_ABSOLUTE_FLOOR}% floor`}`,
          observedAt: now,
        },
      ],
    });
  }

  const totalEstimatedUsdPerMinute = impacted.reduce((sum, s) => sum + (s.estimatedUsdPerMinute ?? 0), 0);

  return {
    hasActiveImpact: impacted.length > 0,
    totalEstimatedUsdPerMinute,
    impactedServices: impacted,
    checkedServiceCount: revenueBearing.length,
  };
}
