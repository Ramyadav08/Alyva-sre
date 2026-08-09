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

export type ErrorRateCheck = {
  elevated: boolean;
  liveErrorRatePercent: number | null;
  baselineErrorRatePercent: number | null;
  evidence: EvidenceRef;
};

/**
 * Shared by BusinessImpactPanel and recovery-check.ts — both need the same
 * "is this service's error rate currently elevated relative to its own
 * discovered baseline" judgment, and recovery verification is meaningless
 * if it uses a different bar than the one that flagged the problem in the
 * first place.
 */
export async function checkErrorRateElevated(profile: ServiceProfile): Promise<ErrorRateCheck> {
  const live = await getServiceHealth(profile.serviceId);
  const now = new Date().toISOString();
  const baseline = profile.discovered.errorRatePercent;
  const threshold = baseline !== null ? baseline + ERROR_RATE_DELTA_THRESHOLD : ERROR_RATE_ABSOLUTE_FLOOR;
  const elevated = live.errorRatePercent !== null && live.errorRatePercent > threshold;
  return {
    elevated,
    liveErrorRatePercent: live.errorRatePercent,
    baselineErrorRatePercent: baseline,
    evidence: {
      type: "metric",
      query: `error-rate ratio for service_name="${profile.serviceId}"`,
      summary:
        live.errorRatePercent !== null
          ? `live error rate ${live.errorRatePercent.toFixed(1)}% vs baseline ${baseline !== null ? baseline.toFixed(1) + "%" : `<${ERROR_RATE_ABSOLUTE_FLOOR}% floor`}`
          : "no live error-rate data",
      observedAt: now,
    },
  };
}

export async function computeActiveBusinessImpact(): Promise<BusinessImpactSummary> {
  const db = await getDb();
  const revenueBearing = db.data.serviceProfiles.filter(
    (p) => p.onboarded && (p.businessContext.tier === "revenue_critical" || p.businessContext.tier === "customer_facing"),
  );

  const impacted: ImpactedService[] = [];

  for (const profile of revenueBearing) {
    const check = await checkErrorRateElevated(profile);
    if (!check.elevated) continue;

    impacted.push({
      serviceId: profile.serviceId,
      tier: profile.businessContext.tier,
      estimatedUsdPerMinute: profile.businessContext.revenuePerIncidentMinuteUsd,
      evidence: [check.evidence],
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
