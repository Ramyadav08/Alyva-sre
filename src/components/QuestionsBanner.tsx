"use client";

/**
 * The visible half of "ask, don't assume": a persistent, impossible-to-miss
 * banner whenever the agent has real pending Questions. Progressive
 * disclosure — headline count first, each question's evidence expands on
 * click, never dumped inline by default.
 */
import { useEffect, useState } from "react";
import type { Question } from "@/lib/models";

const VISIBLE_DEFAULT = 3;

export function QuestionsBanner() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
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
    <div className="rounded-md border border-brand/40 bg-brand/5 p-3">
      <p className="text-sm font-medium text-foreground">
        {questions.length} thing{questions.length === 1 ? "" : "s"} need{questions.length === 1 ? "s" : ""} your
        input before Alyva can finish reasoning about this.
      </p>
      <ul className="mt-2 space-y-2">
        {visible.map((q) => (
          <li key={q.id} className="rounded border border-border bg-card p-2 text-sm">
            <button
              className="text-left w-full font-medium"
              onClick={() => setOpenId(openId === q.id ? null : q.id)}
            >
              {q.prompt}
            </button>
            {openId === q.id && (
              <div className="mt-2 space-y-2">
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
                  <input
                    className="flex-1 rounded border border-input bg-background px-2 py-1 text-sm"
                    value={drafts[q.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                    placeholder="Your answer…"
                    onKeyDown={(e) => e.key === "Enter" && submit(q.id)}
                  />
                  <button
                    className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
                    onClick={() => submit(q.id)}
                  >
                    Answer
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button className="mt-2 text-xs text-muted-foreground underline" onClick={() => setShowAll(true)}>
          Show {hiddenCount} more
        </button>
      )}
      {showAll && questions.length > VISIBLE_DEFAULT && (
        <button className="mt-2 text-xs text-muted-foreground underline" onClick={() => setShowAll(false)}>
          Show fewer
        </button>
      )}
    </div>
  );
}
