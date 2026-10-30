"use client";

// Daily work updates shared with the manager, plus the manager's review status and feedback.
//
// DATA SOURCE: the REST API (GET /daily-updates/). lib/store.ts loads the rows into `dailyUpdates`
// (lib/data.ts) and refetches them after every change, so the database is the only source of truth.
// Reviews and edits are saved with PATCH /daily-updates/<id>/, feedback with POST /daily-updates/<id>/feedback/.

import { api, type ApiDailyUpdate, type DailyUpdateEditInput, type DailyUpdateInput } from "./api";
import { dailyUpdates, type DailyUpdate, type Feedback, type FeedbackType, type ReviewStatus } from "./data";
import { mutate, numericId, SCOPES, useStore } from "./store";

export type { DailyUpdate, Feedback, FeedbackType, OverallStatus, ReviewStatus } from "./data";

export const FEEDBACK_TYPES: FeedbackType[] = ["Suggestion", "Appreciation", "Improvement required", "Next steps"];

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  feedback: "Feedback given",
};

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** All shared updates, newest first (as served). Re-renders the caller whenever the store reloads. */
export function useDailyUpdates(): DailyUpdate[] {
  useStore();
  return dailyUpdates;
}

const reviewing = new Set<string>();

/**
 * Opening an update counts as reviewing it (only moves New -> Reviewed). The status changes only once the server
 * has accepted it, so on failure the update stays "New" (matching the database) and the server's error is thrown
 * for the caller to show.
 */
export async function markReviewed(update: DailyUpdate): Promise<void> {
  if (update.reviewStatus !== "new" || reviewing.has(update.id)) return;
  reviewing.add(update.id);
  try {
    await mutate(() => api.markUpdateReviewed(numericId(update.id)), SCOPES.review);
  } finally {
    reviewing.delete(update.id);
  }
}

/** Shares a daily update for an employee (one per person, project and day). Throws the server's error on failure. */
export async function shareUpdate(body: DailyUpdateInput): Promise<ApiDailyUpdate> {
  return mutate(() => api.createDailyUpdate(body), SCOPES.shareUpdate);
}

/** Saves changes to an update's typed content (only the fields given). Throws the server's error on failure. */
export async function editUpdate(update: DailyUpdate, body: DailyUpdateEditInput): Promise<ApiDailyUpdate> {
  return mutate(() => api.editDailyUpdate(numericId(update.id), body), SCOPES.editUpdate);
}

/** Deletes an update with its feedback. The server refuses (409) while tasks are logged for it. */
export async function deleteUpdate(update: DailyUpdate): Promise<void> {
  await mutate(() => api.deleteDailyUpdate(numericId(update.id)), SCOPES.editUpdate);
}

/** Adds a feedback entry (earlier entries are kept). Throws the server's message on failure. */
export async function addFeedback(update: DailyUpdate | number, type: FeedbackType, content: string): Promise<void> {
  const id = typeof update === "number" ? update : numericId(update.id);
  await mutate(() => api.addFeedback(id, { type, content }), SCOPES.feedback);
}

/** Changes one feedback entry's type and text (no new entry). Throws the server's message on failure. */
export async function editFeedback(feedback: Feedback, type: FeedbackType, content: string): Promise<void> {
  await mutate(() => api.editFeedback(numericId(feedback.updateId), numericId(feedback.id), { type, content }), SCOPES.feedback);
}

/** Deletes one feedback entry; the other entries and the update itself are kept. Throws the server's message on failure. */
export async function deleteFeedback(feedback: Feedback): Promise<void> {
  await mutate(() => api.deleteFeedback(numericId(feedback.updateId), numericId(feedback.id)), SCOPES.feedback);
}
