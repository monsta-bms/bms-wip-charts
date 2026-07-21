export type WithdrawalHandlingMode =
  | "immediate_delete"
  | "grace_auto_delete"
  | "manual_review";

export type WithdrawalHandlingInput = {
  within24Hours: boolean;
  hasDeletionDependencies: boolean;
};

export function classifyWithdrawalHandling(
  input: WithdrawalHandlingInput
): WithdrawalHandlingMode {
  if (input.hasDeletionDependencies) return "manual_review";
  return input.within24Hours ? "immediate_delete" : "grace_auto_delete";
}

export function withdrawalHandlingRequiresReason(mode: WithdrawalHandlingMode): boolean {
  return mode !== "immediate_delete";
}

export function requestModeForHandling(
  mode: WithdrawalHandlingMode
): "immediate" | "deferred" {
  return mode === "immediate_delete" ? "immediate" : "deferred";
}

export function effectiveWithdrawalHandlingSql(alias = "withdrawals"): string {
  return `COALESCE(
    ${alias}.handling_mode,
    CASE
      WHEN ${alias}.request_mode = 'immediate' THEN 'immediate_delete'
      ELSE 'grace_auto_delete'
    END
  )`;
}
