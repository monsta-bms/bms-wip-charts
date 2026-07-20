export type AllowAppendParseResult =
  | { ok: true; value: boolean }
  | { ok: false; detail: string };

export function parseAllowAppend(form: FormData, fallback: boolean): AllowAppendParseResult {
  if (!form.has("allowAppend")) {
    return { ok: true, value: fallback };
  }

  const value = form.get("allowAppend");
  if (value === "true") {
    return { ok: true, value: true };
  }
  if (value === "false") {
    return { ok: true, value: false };
  }

  return {
    ok: false,
    detail: "allowAppend must be exactly true or false."
  };
}
