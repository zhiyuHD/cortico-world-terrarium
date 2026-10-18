export const TERRARIUM_MAX_FEEDBACK_TEXT = 2000;
export const TERRARIUM_MAX_FEEDBACK = 2000;
export const TERRARIUM_FEEDBACK_ANONYMOUS_LIMIT = 20;
export const TERRARIUM_FEEDBACK_BOX_LIMIT = 5;
export const TERRARIUM_FEEDBACK_RATE_INTERVAL_MS = 60_000;
export const TERRARIUM_FEEDBACK_PAGE_SIZE = 100;
export interface TerrariumFeedbackInput { text: string; contact?: string }
export interface TerrariumFeedbackReceipt { id: number; createdAt: string }
export function parseFeedback(value: unknown): TerrariumFeedbackInput {
  const input = value as Partial<TerrariumFeedbackInput> | null;
  if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > TERRARIUM_MAX_FEEDBACK_TEXT || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.text)) throw new Error('Feedback text must contain 1..2000 characters without control characters');
  if (input.contact !== undefined && (typeof input.contact !== 'string' || input.contact.length > 200 || /[\x00-\x1f\x7f]/.test(input.contact))) throw new Error('Feedback contact must be at most 200 characters without control characters');
  return { text: input.text.trim(), ...(input.contact?.trim() ? { contact: input.contact.trim() } : {}) };
}
