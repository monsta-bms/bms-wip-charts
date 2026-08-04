export const COMPLETED_DESCENDANT_SUPERSESSION_REASON = "superseded_by_completed_descendant";

export function isCompletedDescendantSupersession(reason: unknown): boolean {
  return reason === COMPLETED_DESCENDANT_SUPERSESSION_REASON;
}

export function isEffectiveDownloadBlock(
  downloadBlocked: number | boolean,
  downloadBlockReason: string | null
): boolean {
  return Boolean(downloadBlocked) && !isCompletedDescendantSupersession(downloadBlockReason);
}

export function isEffectiveCompletionCollapse(
  collapsedByCompletion: number | boolean,
  collapsedReason: string | null
): boolean {
  return Boolean(collapsedByCompletion) && !isCompletedDescendantSupersession(collapsedReason);
}
