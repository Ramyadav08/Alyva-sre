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

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-sm text-muted-foreground">Alyva — AI-native SRE</span>
        </div>
        <div className="space-y-0.5 text-right">
          <OnboardingRunner />
          <AlertRulesRunner />
          <RecommendationsRunner />
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        <QuestionsBanner />
        <ProposalReviewList kind="profile_field" title="Onboarding — confirm service profiles" />
        <ProposalReviewList kind="alert_rule" title="Alert rules — review" />

        <div className="grid gap-4 sm:grid-cols-2">
          <BusinessImpactPanel />
          <TopLatencyPanel />
        </div>

        <ActiveRulesList />

        <section className="space-y-3">
          <h2 className="section-heading">Ask for a custom panel</h2>
          <CustomPanelChat />
          <CustomPanelsList />
        </section>

        <ProposalReviewList kind="recommendation" title="Recommendations" />
        <ProposalReviewList kind="pr" title="Suggested code fixes" />

        <OnboardedServices />
      </div>
    </main>
  );
}
