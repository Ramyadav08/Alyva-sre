"use client";

/**
 * Dashboard shell. Rebuilt on shadcn/ui primitives (Tabs, Card via child
 * components) with UI/UX inspiration from Traversal, Resolve AI, Cleric,
 * and incident.io (see docs) — same SREonCall brand tokens throughout,
 * no new palette. Two structural changes from the original flat vertical
 * page, both in service of Progressive Disclosure:
 *
 *  - The four "Runner" components used to sit in a plain stacked list in
 *    the header; they're now a small live-activity feed (RunnerStatus) —
 *    still auto-firing on mount with zero buttons, that behavior is
 *    untouched, only its presentation changed.
 *  - Everything that used to be one long scroll is now grouped into tabs
 *    by what a human is actually doing when they look at it: get the
 *    2-line headline (Overview), review pending drafts (Review Queue,
 *    badged with how many), check rule/fix history (Rules & Fixes), ask
 *    for something custom (Custom Panel), or look at raw inventory
 *    (Services). A judge re-triggering the same fault should be able to
 *    find the resulting investigation in Overview without scrolling past
 *    forty alert-rule proposals to get there.
 */
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { QuestionsBanner } from "@/components/QuestionsBanner";
import { OnboardingRunner } from "@/components/OnboardingRunner";
import { OnboardedServices } from "@/components/OnboardedServices";
import { ProposalReviewList } from "@/components/ProposalReviewList";
import { BusinessImpactPanel } from "@/components/BusinessImpactPanel";
import { TopLatencyPanel } from "@/components/TopLatencyPanel";
import { AlertRulesRunner } from "@/components/AlertRulesRunner";
import { ActiveRulesList } from "@/components/ActiveRulesList";
import { CustomPanelChat } from "@/components/CustomPanelChat";
import { CustomPanelsList } from "@/components/CustomPanelsList";
import { RecommendationsRunner } from "@/components/RecommendationsRunner";
import { InvestigationsPanel } from "@/components/InvestigationsPanel";
import { AppliedFixesPanel } from "@/components/AppliedFixesPanel";
import { RecoveryCheckRunner } from "@/components/RecoveryCheckRunner";
import { PostmortemsPanel } from "@/components/PostmortemsPanel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

/** Total pending proposals across every kind — badges the Review Queue tab. */
function usePendingProposalCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch("/api/proposals?status=pending");
        const { proposals } = await res.json();
        if (!cancelled) setCount(proposals.length);
      } catch {
        // Silently keep the previous count — a transient fetch failure
        // here shouldn't blank out an otherwise-working tab badge.
      }
    }
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
  return count;
}

export default function DashboardPage() {
  const pendingCount = usePendingProposalCount();

  return (
    <main className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-sm text-muted-foreground">Alyva — AI-native SRE</span>
        </div>
        {/* Live activity feed — everything here fired on its own when the page loaded. */}
        <div className="flex max-w-xl flex-col items-end gap-1">
          <OnboardingRunner />
          <AlertRulesRunner />
          <RecommendationsRunner />
          <RecoveryCheckRunner />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-6">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="review" className="gap-1.5">
              Review queue
              {pendingCount > 0 && (
                <Badge variant="primary" className="px-1.5">
                  {pendingCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="rules">Rules &amp; fixes</TabsTrigger>
            <TabsTrigger value="custom">Custom panel</TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <QuestionsBanner />
            <div className="grid gap-4 sm:grid-cols-2">
              <BusinessImpactPanel />
              <TopLatencyPanel />
            </div>
            <InvestigationsPanel />
          </TabsContent>

          <TabsContent value="review" className="space-y-6">
            <ProposalReviewList kind="profile_field" title="Onboarding — confirm service profiles" />
            <ProposalReviewList kind="alert_rule" title="Alert rules — review" />
            <ProposalReviewList kind="recommendation" title="Recommendations" />
            <ProposalReviewList kind="pr" title="Suggested code fixes" />
          </TabsContent>

          <TabsContent value="rules" className="space-y-6">
            <ActiveRulesList />
            <AppliedFixesPanel />
            <PostmortemsPanel />
          </TabsContent>

          <TabsContent value="custom" className="space-y-3">
            <h2 className="section-heading">Ask for a custom panel</h2>
            <CustomPanelChat />
            <CustomPanelsList />
          </TabsContent>

          <TabsContent value="services">
            <OnboardedServices />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
