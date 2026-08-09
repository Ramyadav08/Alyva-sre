"use client";

/**
 * The visible half of "ask, don't assume": a persistent, impossible-to-miss
 * banner whenever the agent has real pending Questions. Progressive
 * disclosure — headline count first, each question's evidence expands on
 * click, never dumped inline by default. Rebuilt on shadcn/ui: Card for the
 * attention-getting container, Accordion for the expand/collapse (replaces
 * the old manual openId toggle — same single-open-at-a-time behavior, now
 * via Radix), Input/Button for the answer flow.
 */
import { useEffect, useState } from "react";
import type { Question } from "@/lib/models";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const VISIBLE_DEFAULT = 3;

/** Strips internal matching markers (e.g. draft.ts's BASELINE_ANOMALY_MARKER) that exist so the backend can find a prior answer to this exact gate — not meant to be user-facing. */
function displayPrompt(prompt: string): string {
  return prompt.replace(/^\[[a-z_]+\]\s*/i, "");
}

export function QuestionsBanner() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  async function refresh() {
    const res = await fetch("/api/questions");
    const { questions } = await res.json();
    setQuestions(questions);
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  async function submit(id: string) {
    const answer = drafts[id]?.trim();
    if (!answer) return;
    await fetch(`/api/questions/${id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer }),
    });
    setDrafts((d) => ({ ...d, [id]: "" }));
    await refresh();
  }

  if (questions.length === 0) return null;

  const visible = showAll ? questions : questions.slice(0, VISIBLE_DEFAULT);
  const hiddenCount = questions.length - visible.length;

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Badge variant="warning">{questions.length}</Badge>
          thing{questions.length === 1 ? "" : "s"} need{questions.length === 1 ? "s" : ""} your input before Alyva
          can finish reasoning about this.
        </p>

        <Accordion
          type="single"
          collapsible
          value={openId}
          onValueChange={setOpenId}
          className="mt-2 rounded-md border border-border bg-card px-3"
        >
          {visible.map((q) => (
            <AccordionItem key={q.id} value={q.id}>
              <AccordionTrigger className="text-sm font-medium">{displayPrompt(q.prompt)}</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {q.context.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {q.context.map((e, i) => (
                        <span key={i} className="evidence-chip" title={e.query}>
                          {e.type}: {e.summary}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      value={drafts[q.id] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                      placeholder="Your answer…"
                      onKeyDown={(e) => e.key === "Enter" && submit(q.id)}
                    />
                    <Button size="sm" onClick={() => submit(q.id)}>
                      Answer
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {hiddenCount > 0 && (
          <Button variant="ghost" size="sm" className="mt-2 h-auto p-0 underline" onClick={() => setShowAll(true)}>
            Show {hiddenCount} more
          </Button>
        )}
        {showAll && questions.length > VISIBLE_DEFAULT && (
          <Button variant="ghost" size="sm" className="mt-2 h-auto p-0 underline" onClick={() => setShowAll(false)}>
            Show fewer
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
