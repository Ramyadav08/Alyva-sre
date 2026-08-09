/**
 * The literal "ask, don't assume" mechanism. Whenever a skill needs
 * something it cannot derive from a live LGTM query, it calls
 * `askQuestion` and stops — it must not fabricate a default. The UI
 * surfaces unanswered Questions as a persistent banner; `answerQuestion`
 * is the only way a Question's answer field gets filled.
 */
import { getDb, newId, nowIso } from "./store";
import type { EvidenceRef, Question } from "./models";

export async function askQuestion(args: {
  skill: "onboarding" | "alerting";
  serviceId?: string;
  prompt: string;
  context: EvidenceRef[];
}): Promise<Question> {
  const db = await getDb();
  const question: Question = {
    id: newId("q"),
    skill: args.skill,
    serviceId: args.serviceId,
    prompt: args.prompt,
    context: args.context,
    createdAt: nowIso(),
  };
  db.data.questions.push(question);
  await db.write();
  return question;
}

export async function listUnanswered(skill?: "onboarding" | "alerting"): Promise<Question[]> {
  const db = await getDb();
  return db.data.questions.filter((q) => !q.answer && (!skill || q.skill === skill));
}

export async function answerQuestion(id: string, answer: string): Promise<Question | null> {
  const db = await getDb();
  const question = db.data.questions.find((q) => q.id === id);
  if (!question) return null;
  question.answer = answer;
  question.answeredAt = nowIso();
  await db.write();
  return question;
}
