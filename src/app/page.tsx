import { Logo } from "@/components/Logo";
import { QuestionsBanner } from "@/components/QuestionsBanner";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-sm text-muted-foreground">Alyva — AI-native SRE</span>
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <QuestionsBanner />
        {/* Business Impact + Top Latency panels land here — see task #5 */}
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Dashboard panels come online once onboarding discovers at least one service.
        </div>
      </div>
    </main>
  );
}
