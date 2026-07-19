import { normalizeText } from "./bms";

export const MAX_CHART_NAME_LENGTH = 100;

type ChartNameValidation =
  | { ok: true; value: string; normalizedValue: string }
  | { ok: false; detail: string };

export function validateChartName(rawValue: string): ChartNameValidation {
  const value = rawValue.trim();
  if (!value) {
    return { ok: false, detail: "chartName is required and must not contain only whitespace." };
  }

  if (Array.from(value).length > MAX_CHART_NAME_LENGTH) {
    return { ok: false, detail: `chartName must be ${MAX_CHART_NAME_LENGTH} characters or less.` };
  }

  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return { ok: false, detail: "chartName must remain non-empty after normalization." };
  }

  return { ok: true, value, normalizedValue };
}
