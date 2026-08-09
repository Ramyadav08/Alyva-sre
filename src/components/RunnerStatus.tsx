"use client";

/**
 * Shared presentation shell for the four "Runner" components
 * (OnboardingRunner, AlertRulesRunner, RecommendationsRunner,
 * RecoveryCheckRunner). Each of those fires its own fetch unprompted on
 * mount — that's the actual Agency behavior and is untouched here. This
 * component only changes how the resulting status renders: a small
 * colored dot + label instead of a bare paragraph, so the header reads as
 * a live "the agent just did these things on its own" feed (Datadog
 * Watchdog Insights / Cleric-style activity feed — see UI inspiration
 * notes) rather than a debug log.
 */
import { cn } from "@/lib/utils";

export type RunnerState = "idle" | "running" | "done" | "error";

const DOT_CLASS: Record<RunnerState, string> = {
  idle: "bg-muted-foreground/30",
  running: "bg-info animate-pulse",
  done: "bg-success",
  error: "bg-error",
};

export function RunnerStatus({ state, label }: { state: RunnerState; label: string | null }) {
  if (state === "idle" || !label) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASS[state])} aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  );
}
