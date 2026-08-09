import { Logo } from "@/components/Logo";
import { QuestionsBanner } from "@/components/QuestionsBanner";
import { OnboardingRunner } from "@/components/OnboardingRunner";
import { OnboardedServices } from "@/components/OnboardedServices";
import { ProposalReviewList } from "@/components/ProposalReviewList";
import { BusinessImpactPanel } from "@/components/BusinessImpactPanel";
import { TopLatencyPanel } from "@/components/TopLatencyPanel";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-sm text-muted-foreground">Alyva — AI-native SRE</span>
        </div>
        <OnboardingRunner />
      </header>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        <QuestionsBanner />
        <ProposalReviewList kind="profile_field" title="Onboarding — confirm service profiles" />
        <div className="grid gap-4 sm:grid-cols-2">
          <BusinessImpactPanel />
          <TopLatencyPanel />
        </div>
        <OnboardedServices />
      </div>
    </main>
  );
}
