import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const SCHEMA_VERSION = 1;
export const TXT_FILENAME = "BMS差分共有サイト_文章編集.txt";
export const ENTRY_SEPARATOR = "=".repeat(64);
export const FIELD_SEPARATOR = "-".repeat(64);

export const GROUPS = Object.freeze([
  "01 共通ヘッダー・ナビゲーション",
  "02 トップページ概要",
  "03 投稿フォーム",
  "04 投稿・追記の状態表示",
  "05 投稿一覧・検索",
  "06 詳細・版ツリー",
  "07 お気に入り",
  "08 管理操作・取り下げ・削除申請",
  "09 概要＆使い方",
  "10 難易度表",
  "11 更新履歴",
  "12 エラー・警告・確認文",
  "13 アクセシビリティ文言",
  "14 その他"
]);

const GROUP_ID_PREFIX = Object.freeze({
  "01": "COMMON",
  "02": "HOME",
  "03": "POST",
  "04": "STATUS",
  "05": "LIST",
  "06": "DETAIL",
  "07": "FAVORITES",
  "08": "MANAGEMENT",
  "09": "GUIDE",
  "10": "DIFFICULTY",
  "11": "CHANGELOG",
  "12": "MESSAGE",
  "13": "ACCESSIBILITY",
  "14": "OTHER"
});

const HTML_ATTRIBUTES = new Set(["aria-label", "alt", "placeholder", "title"]);
const HTML_VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr"
]);
const SECRET_NAME_PATTERN = /(?:ADMIN_TOKEN|PASSWORD_HASH_SECRET|ABUSE_HASH_SECRET|WITHDRAWAL_IDEMPOTENCY_SECRET|TURNSTILE_SECRET|TURNSTILE_MODE)/u;
const SECRET_VALUE_PATTERN = /(?:BEGIN [A-Z ]*PRIVATE KEY|\$2[aby]\$\d{2}\$[./A-Za-z0-9]{40,}|(?:api|access|auth|bearer|secret|token|password)[_-]?(?:key|token|secret)?\s*[:=]\s*[A-Za-z0-9_./+\-=]{16,})/iu;

export class SiteCopyError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "SiteCopyError";
    this.code = code;
    this.detail = detail;
  }
}

export function normalizeNewlines(value) {
  return String(value).replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function readUtf8(filePath) {
  const bytes = fs.readFileSync(filePath);
  const text = bytes.toString("utf8");
  if (Buffer.from(text, "utf8").compare(bytes) !== 0 && Buffer.from(`\uFEFF${text}`, "utf8").compare(bytes) !== 0) {
    throw new SiteCopyError("SITE_COPY_TXT_INVALID_ENCODING", "UTF-8として読み込めません。", { path: filePath });
  }
  return normalizeNewlines(text);
}

function decodeHtml(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0" };
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/giu, (match, decimal, hex, name) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return named[name.toLowerCase()] ?? match;
  });
}

function encodeHtmlText(value) {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function encodeHtmlAttribute(value, quote) {
  let encoded = encodeHtmlText(value);
  encoded = quote === "\"" ? encoded.replace(/"/gu, "&quot;") : encoded.replace(/'/gu, "&#39;");
  return encoded;
}

function decodeJsString(raw) {
  let output = "";
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      output += character;
      continue;
    }
    index += 1;
    if (index >= raw.length) {
      output += "\\";
      break;
    }
    const escaped = raw[index];
    const simple = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };
    if (Object.hasOwn(simple, escaped)) {
      output += simple[escaped];
    } else if (escaped === "\n") {
      // JavaScript line continuation.
    } else if (escaped === "\r") {
      if (raw[index + 1] === "\n") index += 1;
    } else if (escaped === "x" && /^[0-9a-f]{2}$/iu.test(raw.slice(index + 1, index + 3))) {
      output += String.fromCodePoint(Number.parseInt(raw.slice(index + 1, index + 3), 16));
      index += 2;
    } else if (escaped === "u" && raw[index + 1] === "{") {
      const close = raw.indexOf("}", index + 2);
      const code = close >= 0 ? raw.slice(index + 2, close) : "";
      if (/^[0-9a-f]{1,6}$/iu.test(code)) {
        output += String.fromCodePoint(Number.parseInt(code, 16));
        index = close;
      } else {
        output += `\\${escaped}`;
      }
    } else if (escaped === "u" && /^[0-9a-f]{4}$/iu.test(raw.slice(index + 1, index + 5))) {
      output += String.fromCharCode(Number.parseInt(raw.slice(index + 1, index + 5), 16));
      index += 4;
    } else {
      output += escaped;
    }
  }
  return output;
}

function encodeJsString(value, quote) {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/\r/gu, "\\r")
    .replace(/\n/gu, "\\n")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029")
    .replace(new RegExp(quote.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"), `\\${quote}`);
}

function escapeTemplateStatic(value) {
  return value.replace(/\\/gu, "\\\\").replace(/`/gu, "\\`").replace(/\$\{/gu, "\\${");
}

function isMeaningfulText(value) {
  const trimmed = value.trim();
  return trimmed.length > 0 && /[\p{L}\p{N}ぁ-んァ-ヶ一-龠]/u.test(trimmed);
}

function hasEditableStaticText(value) {
  const withoutTokens = value.replace(/\{[A-Z][A-Z0-9_]*\}/gu, "").trim();
  return isMeaningfulText(withoutTokens);
}

function isSecretCandidate(value) {
  return SECRET_VALUE_PATTERN.test(value);
}

function normalizeAnchor(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function anchorHash(source, start, end, direction) {
  const width = 120;
  const value = direction === "before"
    ? source.slice(Math.max(0, start - width), start)
    : source.slice(end, Math.min(source.length, end + width));
  return sha256(normalizeAnchor(value));
}

function findTagEnd(source, start) {
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function htmlStructuralCandidates(source, options = {}) {
  const candidates = [];
  const stack = [{ name: "#document", path: "#document", childCounts: new Map(), textCount: 0, skip: false }];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    const textEnd = open < 0 ? source.length : open;
    if (textEnd > cursor) {
      const parent = stack[stack.length - 1];
      parent.textCount += 1;
      if (!parent.skip) {
        const raw = source.slice(cursor, textEnd);
        const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
        const trailing = raw.match(/\s*$/u)?.[0].length ?? 0;
        const start = cursor + leading;
        const end = textEnd - trailing;
        if (end > start) {
          const value = decodeHtml(source.slice(start, end));
          if (isMeaningfulText(value)) {
            candidates.push({
              value,
              rangeStart: start,
              rangeEnd: end,
              kind: value.includes("\n") ? "MULTILINE_TEXT" : "PLAIN_TEXT",
              role: "text",
              locatorType: options.locatorType ?? "HTML_STRUCTURAL",
              locator: {
                structuralPath: parent.path,
                textNode: parent.textCount,
                beforeAnchorSha256: anchorHash(source, start, end, "before"),
                afterAnchorSha256: anchorHash(source, start, end, "after")
              },
              syntax: "html-text",
              protectedTokens: []
            });
          }
        }
      }
    }
    if (open < 0) break;
    if (source.startsWith("<!--", open)) {
      const close = source.indexOf("-->", open + 4);
      cursor = close < 0 ? source.length : close + 3;
      continue;
    }
    const close = findTagEnd(source, open + 1);
    if (close < 0) break;
    const tagSource = source.slice(open + 1, close);
    if (/^\s*[!?]/u.test(tagSource)) {
      cursor = close + 1;
      continue;
    }
    const closingMatch = tagSource.match(/^\s*\/\s*([A-Za-z][\w:-]*)/u);
    if (closingMatch) {
      const tagName = closingMatch[1].toLowerCase();
      for (let index = stack.length - 1; index > 0; index -= 1) {
        const popped = stack.pop();
        if (popped.name === tagName) break;
      }
      cursor = close + 1;
      continue;
    }
    const openingMatch = tagSource.match(/^\s*([A-Za-z][\w:-]*)/u);
    if (!openingMatch) {
      cursor = close + 1;
      continue;
    }
    const tagName = openingMatch[1].toLowerCase();
    const parent = stack[stack.length - 1];
    const ordinal = (parent.childCounts.get(tagName) ?? 0) + 1;
    parent.childCounts.set(tagName, ordinal);
    const idMatch = tagSource.match(/\bid\s*=\s*(["'])(.*?)\1/iu);
    const classMatch = tagSource.match(/\bclass\s*=\s*(["'])(.*?)\1/iu);
    const firstClass = classMatch?.[2].trim().split(/\s+/u).find(Boolean);
    const pathPart = idMatch
      ? `${tagName}#${idMatch[2]}`
      : firstClass
        ? `${tagName}.${firstClass}:nth-of-type(${ordinal})`
        : `${tagName}:nth-of-type(${ordinal})`;
    const elementPath = `${parent.path}>${pathPart}`;
    const attributePattern = /([^\s"'<>/=]+)\s*=\s*(["'])([\s\S]*?)\2/gu;
    for (const match of tagSource.matchAll(attributePattern)) {
      const attributeName = match[1].toLowerCase();
      if (!HTML_ATTRIBUTES.has(attributeName)) continue;
      const rawValue = match[3];
      const value = decodeHtml(rawValue);
      if (!isMeaningfulText(value)) continue;
      const tagRelativeValueStart = match.index + match[0].indexOf(match[2]) + 1;
      const start = open + 1 + tagRelativeValueStart;
      const end = start + rawValue.length;
      candidates.push({
        value,
        rangeStart: start,
        rangeEnd: end,
        kind: "ATTRIBUTE_TEXT",
        role: `attribute:${attributeName}`,
        locatorType: options.locatorType ?? "HTML_STRUCTURAL",
        locator: {
          structuralPath: elementPath,
          attribute: attributeName,
          beforeAnchorSha256: anchorHash(source, start, end, "before"),
          afterAnchorSha256: anchorHash(source, start, end, "after")
        },
        syntax: "html-attribute",
        quote: match[2],
        protectedTokens: []
      });
    }
    const selfClosing = /\/\s*$/u.test(tagSource) || HTML_VOID_ELEMENTS.has(tagName);
    if (!selfClosing) {
      stack.push({
        name: tagName,
        path: elementPath,
        childCounts: new Map(),
        textCount: 0,
        skip: parent.skip || tagName === "script" || tagName === "style"
      });
    }
    cursor = close + 1;
  }
  return candidates;
}

function skipQuoted(source, start, quote) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
    } else if (source[index] === quote) {
      return index + 1;
    }
  }
  return source.length;
}

function skipBlockComment(source, start) {
  const close = source.indexOf("*/", start + 2);
  return close < 0 ? source.length : close + 2;
}

function skipLineComment(source, start) {
  const close = source.indexOf("\n", start + 2);
  return close < 0 ? source.length : close + 1;
}

function looksLikeRegexStart(source, start) {
  const before = source.slice(Math.max(0, start - 80), start);
  const significant = before.match(/(?:^|[\s;{}])(?:return|throw|case|delete|void|typeof|instanceof|in|of)\s*$/u);
  if (significant) return true;
  const previous = before.match(/\S(?=\s*$)/u)?.[0];
  return previous == null || /[([{:;,=!?&|+*%^~<>-]/u.test(previous);
}

function skipRegex(source, start) {
  let inClass = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      index += 1;
    } else if (character === "[") {
      inClass = true;
    } else if (character === "]") {
      inClass = false;
    } else if (character === "/" && !inClass) {
      index += 1;
      while (/[A-Za-z]/u.test(source[index] ?? "")) index += 1;
      return index;
    } else if (character === "\n" || character === "\r") {
      return start + 1;
    }
  }
  return source.length;
}

function readTemplate(source, start) {
  const parts = [];
  let rawStart = start + 1;
  let cursor = rawStart;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === "`") {
      parts.push({ type: "raw", start: rawStart, end: cursor });
      return { start, end: cursor + 1, parts };
    }
    if (source[cursor] === "$" && source[cursor + 1] === "{") {
      parts.push({ type: "raw", start: rawStart, end: cursor });
      const expressionStart = cursor;
      cursor += 2;
      let depth = 1;
      while (cursor < source.length && depth > 0) {
        const character = source[cursor];
        if (character === "\"" || character === "'") {
          cursor = skipQuoted(source, cursor, character);
        } else if (character === "`") {
          cursor = readTemplate(source, cursor).end;
        } else if (source.startsWith("//", cursor)) {
          cursor = skipLineComment(source, cursor);
        } else if (source.startsWith("/*", cursor)) {
          cursor = skipBlockComment(source, cursor);
        } else if (character === "/" && looksLikeRegexStart(source, cursor)) {
          cursor = skipRegex(source, cursor);
        } else {
          if (character === "{") depth += 1;
          if (character === "}") depth -= 1;
          cursor += 1;
        }
      }
      if (depth !== 0) return { start, end: source.length, parts, unterminated: true };
      parts.push({ type: "expression", start: expressionStart, end: cursor });
      rawStart = cursor;
      continue;
    }
    cursor += 1;
  }
  return { start, end: source.length, parts, unterminated: true };
}

function scanJsTokens(source) {
  const tokens = [];
  for (let cursor = 0; cursor < source.length;) {
    if (source.startsWith("//", cursor)) {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      cursor = skipBlockComment(source, cursor);
      continue;
    }
    if (source[cursor] === "/" && looksLikeRegexStart(source, cursor)) {
      cursor = skipRegex(source, cursor);
      continue;
    }
    const character = source[cursor];
    if (character === "\"" || character === "'") {
      const end = skipQuoted(source, cursor, character);
      tokens.push({ type: "string", start: cursor, end, quote: character, contentStart: cursor + 1, contentEnd: end - 1 });
      cursor = end;
      continue;
    }
    if (character === "`") {
      const token = readTemplate(source, cursor);
      tokens.push({ type: "template", ...token, contentStart: cursor + 1, contentEnd: token.end - 1 });
      cursor = token.end;
      continue;
    }
    cursor += 1;
  }
  return tokens;
}

function inferContainer(source, position) {
  const before = source.slice(Math.max(0, position - 5000), position);
  const patterns = [
    /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[^{}]*$/u,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>[^{}]*\{?[^{}]*$/u,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*$/u
  ];
  for (const pattern of patterns) {
    const match = before.match(pattern);
    if (match) return match[1];
  }
  return "module";
}

function inferRole(source, start, end) {
  const before = source.slice(Math.max(0, start - 180), start);
  const after = source.slice(end, Math.min(source.length, end + 80));
  if (/aria-label\s*=|setAttribute\(\s*["']aria-label["']/u.test(before)) return "aria-label";
  if (/placeholder\s*=|\.placeholder\s*=/u.test(before)) return "placeholder";
  if (/\.title\s*=|title\s*:/u.test(before)) return "title";
  if (/confirm\s*\([^)]*$/u.test(before)) return "confirm";
  if (/alert\s*\([^)]*$/u.test(before)) return "alert";
  const call = inferCallArgument(source, start, ["apiError", "publicError", "jsonError"]);
  if (call?.name === "apiError") return call.argumentIndex === 4 ? "api-message" : call.argumentIndex > 4 ? "api-detail" : "string";
  if (call?.name === "publicError") return call.argumentIndex === 3 ? "api-message" : "string";
  if (call?.name === "jsonError") return call.argumentIndex === 3 || call.argumentIndex === 4 ? "api-message" : "string";
  if (/\bmessage\s*:\s*$/u.test(before)) return "message";
  if (/(?:textContent|innerText)\s*=\s*$/u.test(before)) return "text-content";
  if (/(?:status|error|warning|notice|feedback|summary|label|heading|button)[A-Za-z_$]*\s*(?:=|:)\s*$/iu.test(before)) return "ui-status";
  if (/\.(?:setAttribute|insertAdjacentHTML)\s*\([^,]*,?[^)]*$/u.test(before)) return "dom-content";
  if (/\b(?:throw\s+new\s+Error|console\.(?:log|warn|error|info|debug))\s*\([^)]*$/u.test(before)) return "internal";
  if (/^(?:\s*[,;)])/u.test(after) && /(?:button|label|title|heading|caption)/iu.test(before)) return "ui-label";
  return "string";
}

function inferCallArgument(source, position, names) {
  const searchStart = Math.max(0, position - 2400);
  const prefix = source.slice(searchStart, position);
  let selected = null;
  for (const name of names) {
    const pattern = new RegExp(`\\b${name}\\s*\\(`, "gu");
    for (const match of prefix.matchAll(pattern)) {
      if (!selected || match.index > selected.index) selected = { name, index: match.index, open: match.index + match[0].lastIndexOf("(") };
    }
  }
  if (!selected) return null;
  let argumentIndex = 0;
  const stack = [];
  for (let cursor = searchStart + selected.open + 1; cursor < position;) {
    if (source.startsWith("//", cursor)) {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      cursor = skipBlockComment(source, cursor);
      continue;
    }
    const character = source[cursor];
    if (character === "\"" || character === "'") {
      cursor = skipQuoted(source, cursor, character);
      continue;
    }
    if (character === "`") {
      cursor = readTemplate(source, cursor).end;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") stack.push(character);
    else if (character === ")" || character === "]" || character === "}") {
      if (stack.length === 0 && character === ")") return null;
      stack.pop();
    } else if (character === "," && stack.length === 0) argumentIndex += 1;
    cursor += 1;
  }
  return { name: selected.name, argumentIndex };
}

function tokenBase(expression) {
  const normalized = expression.replace(/^\$\{|\}$/gu, "").trim();
  if (/\.length\b/u.test(normalized)) return "COUNT";
  const identifiers = normalized.match(/[A-Za-z_$][\w$]*/gu) ?? [];
  const ignored = new Set(["escapeHtml", "String", "Number", "format", "toString", "map", "join"]);
  const candidate = [...identifiers].reverse().find((value) => !ignored.has(value)) ?? "VALUE";
  return candidate.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").replace(/[^A-Za-z0-9]+/gu, "_").toUpperCase();
}

function buildTemplateModel(source, token) {
  const bindings = [];
  const usedNames = new Map();
  const virtualSegments = [];
  let virtual = "";
  for (const part of token.parts) {
    if (part.type === "raw") {
      const decoded = decodeJsString(source.slice(part.start, part.end));
      const virtualStart = virtual.length;
      virtual += decoded;
      virtualSegments.push({ type: "raw", virtualStart, virtualEnd: virtual.length, sourceStart: part.start, sourceEnd: part.end });
      continue;
    }
    const expression = source.slice(part.start, part.end);
    const base = tokenBase(expression);
    const count = (usedNames.get(base) ?? 0) + 1;
    usedNames.set(base, count);
    const name = count === 1 ? base : `${base}_${count}`;
    const displayToken = `{${name}}`;
    const virtualStart = virtual.length;
    virtual += displayToken;
    virtualSegments.push({ type: "expression", virtualStart, virtualEnd: virtual.length, sourceStart: part.start, sourceEnd: part.end, displayToken, expression });
    bindings.push({ token: displayToken, expression });
  }
  return { virtual, virtualSegments, bindings };
}

function virtualOffsetToSource(segments, offset, edge) {
  for (const segment of segments) {
    if (offset < segment.virtualStart || offset > segment.virtualEnd) continue;
    if (segment.type === "expression") return edge === "start" ? segment.sourceStart : segment.sourceEnd;
    const delta = Math.max(0, Math.min(offset - segment.virtualStart, segment.sourceEnd - segment.sourceStart));
    return segment.sourceStart + delta;
  }
  const last = segments.at(-1);
  return last?.sourceEnd ?? 0;
}

function templateBindingsForValue(bindings, value) {
  return bindings.filter((binding) => value.includes(binding.token));
}

function codeCandidate(source, token, value, start, end, options = {}) {
  const container = inferContainer(source, token.start);
  const role = options.role ?? inferRole(source, start, end);
  const bindings = options.bindings ?? [];
  return {
    value,
    rangeStart: start,
    rangeEnd: end,
    kind: bindings.length > 0 ? "TEMPLATE_TEXT" : options.kind ?? "PLAIN_TEXT",
    role,
    locatorType: options.locatorType ?? "CODE_ANCHOR",
    locator: {
      container,
      role,
      beforeAnchorSha256: anchorHash(source, start, end, "before"),
      afterAnchorSha256: anchorHash(source, start, end, "after")
    },
    syntax: options.syntax ?? "js-string",
    quote: token.quote,
    protectedTokens: bindings.map((binding) => binding.token),
    templateBindings: bindings
  };
}

function shouldIncludeCodeCandidate(value, role, sourcePath, source, start) {
  if (!isMeaningfulText(value) || isSecretCandidate(value)) return false;
  if (/^(?:https?:|application\/|text\/|#[0-9A-Fa-f]{3,8}$|[A-Z][A-Z0-9_]{2,})/u.test(value.trim())) return false;
  const before = source.slice(Math.max(0, start - 220), start);
  if (role === "internal" || /(?:console\.(?:log|warn|error|info|debug)|throw\s+new\s+Error)\s*\([^)]*$/u.test(before)) return false;
  const isWorker = sourcePath.startsWith("worker/");
  if (isWorker) {
    if (sourcePath.endsWith("difficultyTableHtml.ts")) {
      if (role === "text" || role.startsWith("attribute:")) return hasEditableStaticText(value);
      return /[ぁ-んァ-ヶ一-龠]/u.test(value);
    }
    if (sourcePath.endsWith("difficultyTables.ts") && /(?:name|label)\s*:\s*$/u.test(before)) return true;
    if (sourcePath.endsWith("difficultyTables.ts") && /(?:publicError\s*\(|message\s*:)/u.test(before)) return /[ぁ-んァ-ヶ一-龠]/u.test(value);
    return role === "api-message" || (role === "message" && /[ぁ-んァ-ヶ一-龠]/u.test(value));
  }
  if (/[ぁ-んァ-ヶ一-龠]/u.test(value)) return true;
  return role !== "string" && /[A-Za-z]/u.test(value) && value.trim().includes(" ");
}

function codeCandidates(source, sourcePath) {
  const candidates = [];
  for (const token of scanJsTokens(source)) {
    if (token.type === "string") {
      const value = decodeJsString(source.slice(token.contentStart, token.contentEnd));
      if (/<[A-Za-z!/]/u.test(value)) {
        for (const htmlCandidate of htmlStructuralCandidates(value, { locatorType: "STRING_HTML_STRUCTURAL" })) {
          const start = token.contentStart + htmlCandidate.rangeStart;
          const end = token.contentStart + htmlCandidate.rangeEnd;
          if (!shouldIncludeCodeCandidate(htmlCandidate.value, htmlCandidate.role, sourcePath, source, start)) continue;
          const candidate = codeCandidate(source, token, htmlCandidate.value, start, end, {
            role: htmlCandidate.role,
            kind: htmlCandidate.kind,
            locatorType: "STRING_HTML_STRUCTURAL",
            syntax: htmlCandidate.syntax === "html-attribute" ? "js-html-attribute" : "js-html-text"
          });
          candidate.locator.structuralPath = htmlCandidate.locator.structuralPath;
          if (htmlCandidate.locator.attribute) candidate.locator.attribute = htmlCandidate.locator.attribute;
          if (htmlCandidate.locator.textNode) candidate.locator.textNode = htmlCandidate.locator.textNode;
          candidate.htmlQuote = htmlCandidate.quote;
          candidates.push(candidate);
        }
        continue;
      }
      const role = inferRole(source, token.contentStart, token.contentEnd);
      if (shouldIncludeCodeCandidate(value, role, sourcePath, source, token.contentStart)) {
        candidates.push(codeCandidate(source, token, value, token.contentStart, token.contentEnd, {
          role,
          kind: role === "api-message" || (sourcePath.startsWith("worker/") && role === "message") ? "API_MESSAGE" : "PLAIN_TEXT"
        }));
      }
      continue;
    }
    if (token.unterminated) continue;
    const model = buildTemplateModel(source, token);
    if (/<[A-Za-z!/]/u.test(model.virtual)) {
      const htmlCandidates = htmlStructuralCandidates(model.virtual, { locatorType: "TEMPLATE_HTML_STRUCTURAL" });
      for (const htmlCandidate of htmlCandidates) {
        const bindings = templateBindingsForValue(model.bindings, htmlCandidate.value);
        const start = virtualOffsetToSource(model.virtualSegments, htmlCandidate.rangeStart, "start");
        const end = virtualOffsetToSource(model.virtualSegments, htmlCandidate.rangeEnd, "end");
        const value = htmlCandidate.value;
        const role = htmlCandidate.role;
        if (!shouldIncludeCodeCandidate(value, role, sourcePath, source, start)) continue;
        const candidate = codeCandidate(source, token, value, start, end, {
          role,
          kind: htmlCandidate.kind,
          locatorType: "TEMPLATE_HTML_STRUCTURAL",
          syntax: htmlCandidate.syntax === "html-attribute" ? "template-html-attribute" : "template-html-text",
          bindings
        });
        candidate.locator.structuralPath = htmlCandidate.locator.structuralPath;
        if (htmlCandidate.locator.attribute) candidate.locator.attribute = htmlCandidate.locator.attribute;
        if (htmlCandidate.locator.textNode) candidate.locator.textNode = htmlCandidate.locator.textNode;
        candidate.quote = htmlCandidate.quote;
        candidates.push(candidate);
      }
    } else {
      const value = model.virtual;
      const role = inferRole(source, token.contentStart, token.contentEnd);
      if (hasEditableStaticText(value) && shouldIncludeCodeCandidate(value, role, sourcePath, source, token.contentStart)) {
        candidates.push(codeCandidate(source, token, value, token.contentStart, token.contentEnd, {
          role,
          kind: "TEMPLATE_TEXT",
          syntax: "js-template",
          bindings: model.bindings
        }));
      }
    }
  }
  return candidates;
}

function cssCandidates(source) {
  const candidates = [];
  const pattern = /\bcontent\s*:\s*(["'])([\s\S]*?)\1/gu;
  for (const match of source.matchAll(pattern)) {
    const value = decodeJsString(match[2]);
    if (!/[ぁ-んァ-ヶ一-龠]/u.test(value)) continue;
    const start = match.index + match[0].indexOf(match[1]) + 1;
    const end = start + match[2].length;
    candidates.push({
      value,
      rangeStart: start,
      rangeEnd: end,
      kind: "PLAIN_TEXT",
      role: "css-content",
      locatorType: "CSS_DECLARATION",
      locator: {
        property: "content",
        beforeAnchorSha256: anchorHash(source, start, end, "before"),
        afterAnchorSha256: anchorHash(source, start, end, "after")
      },
      syntax: "css-string",
      quote: match[1],
      protectedTokens: []
    });
  }
  return candidates;
}

export function scanSource(sourcePath, source) {
  let candidates = [];
  if (sourcePath.endsWith(".html")) candidates = htmlStructuralCandidates(source);
  else if (sourcePath.endsWith(".js") || sourcePath.endsWith(".ts")) candidates = codeCandidates(source, sourcePath);
  else if (sourcePath.endsWith(".css")) candidates = cssCandidates(source);
  const occurrences = new Map();
  for (const candidate of candidates) {
    candidate.sourceNewline = source.slice(candidate.rangeStart, candidate.rangeEnd).includes("\r\n") ? "\r\n" : "\n";
    candidate.value = normalizeNewlines(candidate.value);
    const base = `${candidate.locatorType}:${JSON.stringify(candidate.locator)}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    candidate.locator.occurrenceWithinContainer = occurrence;
  }
  return candidates;
}

function groupFor(sourcePath, candidate) {
  const lower = `${sourcePath} ${candidate.role}`.toLowerCase();
  const structuralPath = candidate.locator.structuralPath ?? "";
  if (candidate.role === "aria-label" || candidate.role.startsWith("attribute:aria") || candidate.role === "attribute:alt") return GROUPS[12];
  if (candidate.kind === "API_MESSAGE" || /error|warning|confirm|alert|notice|feedback|message|status/u.test(candidate.role)) return GROUPS[11];
  if (sourcePath === "docs/index.html") {
    if (/recycleOverviewTitle|recycle-overview/u.test(structuralPath)) return GROUPS[1];
    if (/versionManagement|withdrawal/u.test(structuralPath)) return GROUPS[7];
    if (/selectedChart/u.test(structuralPath)) return GROUPS[5];
    if (/>section#list|listTitle/u.test(structuralPath)) return GROUPS[4];
    if (/>section#post|chartForm|submitTitle/u.test(structuralPath)) return GROUPS[2];
  }
  if (/site-header|theme-controller/u.test(lower)) return GROUPS[0];
  if (/difficultytable/u.test(lower)) return GROUPS[9];
  if (/changelog/u.test(lower)) return GROUPS[10];
  if (/guide/u.test(lower)) return GROUPS[8];
  if (/admin|management|withdrawal|ban/u.test(lower)) return GROUPS[7];
  if (/favorite/u.test(lower)) return GROUPS[6];
  if (/branch|tree|chart-detail|version-/u.test(lower)) return GROUPS[5];
  if (/list/u.test(lower)) return GROUPS[4];
  if (/post-form|turnstile|chart-metadata|progress-image|local-bms|zip-bms|index\.html/u.test(lower)) {
    if (/status|解析|投稿中|成功|失敗|読み込み/u.test(candidate.value)) return GROUPS[3];
    return GROUPS[2];
  }
  if (/docs\/app\.js/u.test(lower)) return GROUPS[3];
  if (/docs\/index\.html/u.test(lower)) return GROUPS[1];
  return GROUPS[13];
}

function sourceSlug(sourcePath) {
  return sourcePath.replace(/[^A-Za-z0-9]+/gu, "_").replace(/^_|_$/gu, "").toUpperCase();
}

function kindSlug(kind) {
  return ({ PLAIN_TEXT: "TEXT", MULTILINE_TEXT: "MULTILINE", ATTRIBUTE_TEXT: "ATTRIBUTE", TEMPLATE_TEXT: "TEMPLATE", RICH_TEXT: "RICH", API_MESSAGE: "API" })[kind] ?? "TEXT";
}

function locatorIdentity(locatorType, locator) {
  return `${locatorType}:${JSON.stringify(locator)}`;
}

export function inventoryRepository(rootDir, catalogId, baseCommit) {
  const paths = [];
  for (const name of fs.readdirSync(path.join(rootDir, "docs"))) {
    const relative = `docs/${name}`;
    if (/\.(?:html|js|css)$/u.test(name)) paths.push(relative);
  }
  for (const directory of ["worker/src/routes", "worker/src/services"]) {
    for (const name of fs.readdirSync(path.join(rootDir, directory))) {
      if (name.endsWith(".ts")) paths.push(`${directory}/${name}`);
    }
  }
  paths.push("worker/src/utils/difficultyTableHtml.ts");
  paths.sort((a, b) => a.localeCompare(b, "en"));
  const rawEntries = [];
  const manualReview = [];
  for (const sourcePath of paths) {
    const source = fs.readFileSync(path.join(rootDir, sourcePath), "utf8");
    for (const candidate of scanSource(sourcePath, source)) {
      if (isSecretCandidate(candidate.value)) {
        throw new SiteCopyError("SITE_COPY_EXPORT_SECRET_CANDIDATE", "Secret候補を検出したためexportを停止しました。", { path: sourcePath, count: 1 });
      }
      if (SECRET_NAME_PATTERN.test(candidate.value) && !sourcePath.startsWith("worker/src/utils/difficultyTableHtml")) {
        // Secret names are explicitly outside the editable-copy contract.
        continue;
      }
      rawEntries.push({ sourcePath, candidate, group: groupFor(sourcePath, candidate) });
    }
  }
  rawEntries.sort((left, right) => {
    const groupCompare = left.group.localeCompare(right.group, "ja");
    if (groupCompare !== 0) return groupCompare;
    const pathCompare = left.sourcePath.localeCompare(right.sourcePath, "en");
    if (pathCompare !== 0) return pathCompare;
    return left.candidate.rangeStart - right.candidate.rangeStart;
  });
  const counters = new Map();
  const locatorSet = new Set();
  const entries = rawEntries.map(({ sourcePath, candidate, group }) => {
    const groupNumber = group.slice(0, 2);
    const counterKey = `${groupNumber}:${sourcePath}:${candidate.kind}`;
    const number = (counters.get(counterKey) ?? 0) + 1;
    counters.set(counterKey, number);
    const id = `${GROUP_ID_PREFIX[groupNumber]}.${sourceSlug(sourcePath)}.${kindSlug(candidate.kind)}_${String(number).padStart(3, "0")}`;
    const locatorKey = `${sourcePath}:${locatorIdentity(candidate.locatorType, candidate.locator)}`;
    if (locatorSet.has(locatorKey)) {
      throw new SiteCopyError("SITE_COPY_EXPORT_AMBIGUOUS_LOCATOR", "locatorが重複しました。", { path: sourcePath, count: 2 });
    }
    locatorSet.add(locatorKey);
    return {
      id,
      group,
      displayLocation: `${sourcePath} > ${candidate.locator.container ?? candidate.locator.structuralPath ?? candidate.role} > ${candidate.role}`,
      deploymentTarget: sourcePath.startsWith("worker/") ? "WORKER" : "PAGES",
      kind: candidate.kind,
      sourcePath,
      locatorType: candidate.locatorType,
      locator: candidate.locator,
      sourceValueSha256: sha256(candidate.value),
      allowEmpty: false,
      maxLength: null,
      protectedTokens: candidate.protectedTokens,
      relatedIds: [],
      retired: false
    };
  });
  const duplicateIds = entries.filter((entry, index) => entries.findIndex((item) => item.id === entry.id) !== index);
  if (duplicateIds.length > 0) {
    throw new SiteCopyError("SITE_COPY_EXPORT_DUPLICATE_ID", "固定IDが重複しました。", { count: duplicateIds.length, ids: [...new Set(duplicateIds.map((entry) => entry.id))] });
  }
  return { manifestVersion: SCHEMA_VERSION, catalogId, baseCommit, entries, manualReview };
}

export function loadManifest(filePath) {
  const manifest = JSON.parse(readUtf8(filePath));
  if (manifest.manifestVersion !== SCHEMA_VERSION || !Array.isArray(manifest.entries)) {
    throw new SiteCopyError("SITE_COPY_TXT_SCHEMA_UNSUPPORTED", "manifest schemaに対応していません。", { schemaVersion: manifest.manifestVersion });
  }
  return manifest;
}

function candidateMatchesEntry(candidate, entry) {
  if (candidate.locatorType !== entry.locatorType) return false;
  const expected = entry.locator;
  const actual = candidate.locator;
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) return false;
  }
  return true;
}

function candidateMatchesStableLocator(candidate, entry) {
  if (candidate.locatorType !== entry.locatorType) return false;
  const keys = entry.locatorType.includes("HTML")
    ? ["structuralPath", "attribute", "textNode", "container", "role", "occurrenceWithinContainer"]
    : ["container", "role", "property", "occurrenceWithinContainer"];
  return keys.every((key) => entry.locator[key] === undefined || candidate.locator[key] === entry.locator[key]);
}

export function resolveEntry(rootDir, entry, sourceCache = new Map()) {
  const absolutePath = path.join(rootDir, entry.sourcePath);
  let source = sourceCache.get(entry.sourcePath);
  if (source === undefined) {
    source = fs.readFileSync(absolutePath, "utf8");
    sourceCache.set(entry.sourcePath, source);
  }
  const matches = scanSource(entry.sourcePath, source).filter((candidate) => candidateMatchesEntry(candidate, entry));
  if (matches.length !== 1) {
    throw new SiteCopyError("SITE_COPY_EXPORT_AMBIGUOUS_LOCATOR", "locatorを一意に解決できません。", { id: entry.id, path: entry.sourcePath, count: matches.length });
  }
  const candidate = matches[0];
  if (sha256(candidate.value) !== entry.sourceValueSha256) {
    throw new SiteCopyError("SITE_COPY_SOURCE_BASELINE_MISMATCH", "source baselineが一致しません。", { id: entry.id, path: entry.sourcePath });
  }
  return { source, candidate };
}

export function assertManifest(manifest, rootDir) {
  const ids = new Set();
  const locators = new Set();
  const sourceCache = new Map();
  for (const entry of manifest.entries.filter((item) => !item.retired)) {
    if (!/^[A-Z0-9._]+$/u.test(entry.id) || !GROUPS.includes(entry.group) || !["PAGES", "WORKER"].includes(entry.deploymentTarget)) {
      throw new SiteCopyError("SITE_COPY_EXPORT_UNSUPPORTED_TEXT", "manifest entryの分類が不正です。", { id: entry.id });
    }
    if (path.isAbsolute(entry.sourcePath) || entry.sourcePath.split("/").includes("..") || Object.keys(entry.locator).some((key) => /^(?:line|lineNumber)$/iu.test(key))) {
      throw new SiteCopyError("SITE_COPY_EXPORT_UNSUPPORTED_TEXT", "manifest locatorが不正です。", { id: entry.id, path: entry.sourcePath });
    }
    if (ids.has(entry.id)) throw new SiteCopyError("SITE_COPY_EXPORT_DUPLICATE_ID", "固定IDが重複しています。", { id: entry.id, count: 2 });
    ids.add(entry.id);
    const locatorKey = `${entry.sourcePath}:${locatorIdentity(entry.locatorType, entry.locator)}`;
    if (locators.has(locatorKey)) throw new SiteCopyError("SITE_COPY_EXPORT_AMBIGUOUS_LOCATOR", "locatorが重複しています。", { id: entry.id, path: entry.sourcePath, count: 2 });
    locators.add(locatorKey);
    const { candidate } = resolveEntry(rootDir, entry, sourceCache);
    if (JSON.stringify(candidate.protectedTokens) !== JSON.stringify(entry.protectedTokens)) {
      throw new SiteCopyError("SITE_COPY_EXPORT_TEMPLATE_UNSAFE", "保護トークン定義がsourceと一致しません。", { id: entry.id, count: candidate.protectedTokens.length });
    }
  }
  return sourceCache;
}

function git(rootDir, args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8", windowsHide: true }).trim();
}

export function assertExportRepository(rootDir) {
  const normalizedRoot = path.resolve(rootDir);
  if (normalizedRoot.toLowerCase().includes("quarantine") || !fs.existsSync(path.join(rootDir, ".git"))) {
    throw new SiteCopyError("SITE_COPY_EXPORT_REPO_INVALID", "正式cloneではありません。", { path: normalizedRoot });
  }
  if (git(rootDir, ["branch", "--show-current"]) !== "main") {
    throw new SiteCopyError("SITE_COPY_EXPORT_REPO_INVALID", "main branchではありません。", { path: normalizedRoot });
  }
  if (git(rootDir, ["status", "--porcelain"]) !== "") {
    throw new SiteCopyError("SITE_COPY_EXPORT_WORKTREE_DIRTY", "worktreeがcleanではありません。", { path: normalizedRoot });
  }
  if (fs.existsSync(path.join(rootDir, "wrangler.jsonc"))) {
    throw new SiteCopyError("SITE_COPY_EXPORT_REPO_INVALID", "root wrangler.jsoncを検出しました。", { path: "wrangler.jsonc" });
  }
  const originUrl = git(rootDir, ["remote", "get-url", "origin"]);
  if (!/(?:github\.com[/:])monsta-bms\/bms-wip-charts(?:\.git)?$/iu.test(originUrl)) {
    throw new SiteCopyError("SITE_COPY_EXPORT_REPO_INVALID", "対象repositoryの正式originではありません。", { remote: "origin" });
  }
  const head = git(rootDir, ["rev-parse", "HEAD"]);
  const originMain = git(rootDir, ["rev-parse", "origin/main"]);
  const counts = git(rootDir, ["rev-list", "--left-right", "--count", "origin/main...HEAD"]).split(/\s+/u).map(Number);
  if (counts[0] !== 0 || (head !== originMain && counts[1] < 1)) {
    throw new SiteCopyError("SITE_COPY_EXPORT_REPO_INVALID", "origin/mainとの同期状態が不正です。", { behind: counts[0], ahead: counts[1] });
  }
  return { head, originMain, behind: counts[0], ahead: counts[1] };
}

function entryMetadata(entry) {
  return {
    "ID": entry.id,
    "グループ": entry.group,
    "画面上の場所": entry.displayLocation,
    "反映先": entry.deploymentTarget,
    "種別": entry.kind,
    "空欄許可": entry.allowEmpty ? "YES" : "NO",
    "最大文字数": entry.maxLength == null ? "NONE" : String(entry.maxLength),
    "保護トークン": entry.protectedTokens.length === 0 ? "NONE" : entry.protectedTokens.join(", "),
    "関連項目": entry.relatedIds.length === 0 ? "NONE" : entry.relatedIds.join(", "),
    "元ファイル": entry.sourcePath,
    "元位置": JSON.stringify(entry.locator),
    "元文章SHA256": entry.sourceValueSha256
  };
}

export function buildExport(rootDir, manifest, exportedAt = new Date().toISOString()) {
  const sourceCache = assertManifest(manifest, rootDir);
  const head = git(rootDir, ["rev-parse", "HEAD"]);
  const activeEntries = manifest.entries.filter((entry) => !entry.retired);
  const snapshotEntries = activeEntries.map((entry) => {
    const { candidate } = resolveEntry(rootDir, entry, sourceCache);
    return { ...entry, currentValue: candidate.value };
  });
  const snapshot = {
    manifestVersion: manifest.manifestVersion,
    catalogId: manifest.catalogId,
    baseCommit: head,
    exportedAt,
    entries: snapshotEntries
  };
  const snapshotText = canonicalJson(snapshot);
  const manifestSha256 = sha256(snapshotText);
  const header = [
    "# BMS-WIP SITE COPY EDIT v1",
    "# このファイルでは「編集後」欄だけを書き換えてください。",
    "# ID、種別、対象、保護トークン、区切り行は変更しないでください。",
    `SCHEMA_VERSION: ${SCHEMA_VERSION}`,
    `CATALOG_ID: ${manifest.catalogId}`,
    `BASE_COMMIT: ${head}`,
    `MANIFEST_SHA256: ${manifestSha256}`,
    `EXPORTED_AT: ${exportedAt}`,
    `ENTRY_COUNT: ${snapshotEntries.length}`,
    ""
  ];
  const chunks = [...header];
  for (const group of GROUPS) {
    const entries = snapshotEntries.filter((entry) => entry.group === group);
    if (entries.length === 0) continue;
    chunks.push(`## ${group}`, "");
    for (const entry of entries) {
      chunks.push(ENTRY_SEPARATOR);
      const metadata = entryMetadata(entry);
      for (const [name, value] of Object.entries(metadata)) chunks.push(`${name}: ${value}`);
      chunks.push(FIELD_SEPARATOR, "【現在】", entry.currentValue, FIELD_SEPARATOR, "【編集後】", entry.currentValue, ENTRY_SEPARATOR, "");
    }
  }
  return { snapshot, snapshotText, manifestSha256, txt: `${chunks.join("\n")}\n` };
}

function parseHeader(lines) {
  const requiredComments = [
    "# BMS-WIP SITE COPY EDIT v1",
    "# このファイルでは「編集後」欄だけを書き換えてください。",
    "# ID、種別、対象、保護トークン、区切り行は変更しないでください。"
  ];
  if (requiredComments.some((value, index) => lines[index] !== value)) {
    throw new SiteCopyError("SITE_COPY_TXT_INVALID_HEADER", "TXT headerが不正です。", {});
  }
  const header = {};
  let index = 3;
  for (; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-Z0-9_]+): (.*)$/u);
    if (!match) break;
    header[match[1]] = match[2];
  }
  return { header, nextIndex: index };
}

function parseEntryBlock(lines, start) {
  let cursor = start + 1;
  const metadata = {};
  while (cursor < lines.length && lines[cursor] !== FIELD_SEPARATOR) {
    const match = lines[cursor].match(/^([^:]+): (.*)$/u);
    if (!match) throw new SiteCopyError("SITE_COPY_TXT_METADATA_CHANGED", "entry metadataが不正です。", { near: metadata.ID ?? "UNKNOWN" });
    metadata[match[1]] = match[2];
    cursor += 1;
  }
  if (lines[cursor] !== FIELD_SEPARATOR || lines[cursor + 1] !== "【現在】") {
    throw new SiteCopyError("SITE_COPY_TXT_METADATA_CHANGED", "【現在】区切りが不正です。", { near: metadata.ID ?? "UNKNOWN" });
  }
  cursor += 2;
  const current = [];
  while (cursor < lines.length && lines[cursor] !== FIELD_SEPARATOR) current.push(lines[cursor++]);
  if (lines[cursor] !== FIELD_SEPARATOR || lines[cursor + 1] !== "【編集後】") {
    throw new SiteCopyError("SITE_COPY_TXT_METADATA_CHANGED", "【編集後】区切りが不正です。", { near: metadata.ID ?? "UNKNOWN" });
  }
  cursor += 2;
  const edited = [];
  while (cursor < lines.length && lines[cursor] !== ENTRY_SEPARATOR) edited.push(lines[cursor++]);
  if (lines[cursor] !== ENTRY_SEPARATOR) {
    throw new SiteCopyError("SITE_COPY_TXT_METADATA_CHANGED", "entry終端が不正です。", { near: metadata.ID ?? "UNKNOWN" });
  }
  return { entry: { metadata, current: current.join("\n"), edited: edited.join("\n") }, nextIndex: cursor + 1 };
}

export function parseEditedTxt(text) {
  const normalized = normalizeNewlines(text);
  const lines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  const { header, nextIndex } = parseHeader(lines);
  if (header.SCHEMA_VERSION !== String(SCHEMA_VERSION)) {
    throw new SiteCopyError("SITE_COPY_TXT_SCHEMA_UNSUPPORTED", "TXT schemaに対応していません。", { schemaVersion: header.SCHEMA_VERSION ?? null });
  }
  const entries = [];
  for (let cursor = nextIndex; cursor < lines.length;) {
    if (lines[cursor] === "" || /^## /u.test(lines[cursor])) {
      cursor += 1;
      continue;
    }
    if (lines[cursor] !== ENTRY_SEPARATOR) {
      throw new SiteCopyError("SITE_COPY_TXT_METADATA_CHANGED", "未知のTXT構造を検出しました。", { near: entries.at(-1)?.metadata.ID ?? "HEADER" });
    }
    const parsed = parseEntryBlock(lines, cursor);
    entries.push(parsed.entry);
    cursor = parsed.nextIndex;
  }
  return { header, entries };
}

function tokenCounts(value) {
  const counts = new Map();
  for (const match of value.matchAll(/\{\{\/?[A-Z][A-Z0-9_]*:[A-Z][A-Z0-9_]*\}\}|\{\{\/?[A-Z][A-Z0-9_]*\}\}|\{[A-Z][A-Z0-9_]*\}/gu)) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }
  return counts;
}

function assertProtectedTokens(entry, edited) {
  const actual = tokenCounts(edited);
  const expected = tokenCounts(entry.currentValue);
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  if ([...keys].some((key) => expected.get(key) !== actual.get(key))) {
    throw new SiteCopyError("SITE_COPY_TXT_PROTECTED_TOKEN_MISMATCH", "保護トークンが一致しません。", { id: entry.id });
  }
  const stack = [];
  for (const match of edited.matchAll(/\{\{(\/)?([A-Z][A-Z0-9_]*(?::[A-Z][A-Z0-9_]*)?)\}\}/gu)) {
    if (!match[1]) stack.push(match[2]);
    else if (stack.pop() !== match[2]) throw new SiteCopyError("SITE_COPY_TXT_PROTECTED_TOKEN_MISMATCH", "保護ブロック構造が一致しません。", { id: entry.id });
  }
  if (stack.length > 0) throw new SiteCopyError("SITE_COPY_TXT_PROTECTED_TOKEN_MISMATCH", "保護ブロックが閉じていません。", { id: entry.id });
}

export function validateEditedTxt(text, snapshot, expectedManifestSha256, options = {}) {
  const parsed = parseEditedTxt(text);
  if (parsed.header.CATALOG_ID !== snapshot.catalogId) throw new SiteCopyError("SITE_COPY_TXT_CATALOG_MISMATCH", "CATALOG_IDが一致しません。", {});
  if (parsed.header.MANIFEST_SHA256 !== expectedManifestSha256) throw new SiteCopyError("SITE_COPY_TXT_MANIFEST_MISMATCH", "MANIFEST_SHA256が一致しません。", {});
  if (parsed.header.BASE_COMMIT !== snapshot.baseCommit || parsed.header.EXPORTED_AT !== snapshot.exportedAt || parsed.header.ENTRY_COUNT !== String(snapshot.entries.length)) {
    throw new SiteCopyError("SITE_COPY_TXT_INVALID_HEADER", "export metadataが一致しません。", {});
  }
  const seen = new Set();
  for (const item of parsed.entries) {
    const id = item.metadata.ID;
    if (seen.has(id)) throw new SiteCopyError("SITE_COPY_TXT_DUPLICATE_ID", "IDが重複しています。", { id });
    seen.add(id);
  }
  const expectedIds = new Set(snapshot.entries.map((entry) => entry.id));
  const missing = [...expectedIds].filter((id) => !seen.has(id));
  if (missing.length > 0) throw new SiteCopyError("SITE_COPY_TXT_ENTRY_MISSING", "entryが不足しています。", { ids: missing });
  const unknown = [...seen].filter((id) => !expectedIds.has(id));
  if (unknown.length > 0) throw new SiteCopyError("SITE_COPY_TXT_UNKNOWN_ENTRY", "未知のentryがあります。", { ids: unknown });
  const byId = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  const changes = [];
  for (const item of parsed.entries) {
    const entry = byId.get(item.metadata.ID);
    const expectedMetadata = entryMetadata(entry);
    if (Object.keys(expectedMetadata).length !== Object.keys(item.metadata).length || Object.entries(expectedMetadata).some(([key, value]) => item.metadata[key] !== value)) {
      throw new SiteCopyError("SITE_COPY_TXT_METADATA_CHANGED", "entry metadataが変更されています。", { id: entry.id });
    }
    if (item.current !== entry.currentValue || sha256(item.current) !== entry.sourceValueSha256) {
      throw new SiteCopyError("SITE_COPY_TXT_METADATA_CHANGED", "【現在】欄が変更されています。", { id: entry.id });
    }
    assertProtectedTokens(entry, item.edited);
    if (!entry.allowEmpty && item.edited.length === 0) throw new SiteCopyError("SITE_COPY_TXT_EMPTY_NOT_ALLOWED", "空欄を許可していません。", { id: entry.id });
    if (entry.maxLength != null && [...item.edited].length > entry.maxLength) throw new SiteCopyError("SITE_COPY_TXT_LENGTH_EXCEEDED", "最大文字数を超えています。", { id: entry.id, maxLength: entry.maxLength, actualLength: [...item.edited].length });
    if (isSecretCandidate(item.edited)) throw new SiteCopyError("SITE_COPY_APPLY_UNSUPPORTED_CHANGE", "機密候補を含む編集は反映できません。", { id: entry.id });
    if (item.edited !== item.current) {
      changes.push({ entry, before: item.current, after: item.edited, beforeLength: [...item.current].length, afterLength: [...item.edited].length });
    }
  }
  if (options.rootDir) {
    const sourceCache = new Map();
    for (const entry of snapshot.entries) {
      try {
        resolveEntry(options.rootDir, entry, sourceCache);
      } catch (error) {
        if (error instanceof SiteCopyError) throw new SiteCopyError("SITE_COPY_SOURCE_BASELINE_MISMATCH", "source baselineが一致しません。", { id: entry.id, path: entry.sourcePath });
        throw error;
      }
    }
  }
  return {
    code: "SITE_COPY_TXT_VALIDATION_COMPLETE",
    entryCount: parsed.entries.length,
    changeCount: changes.length,
    pagesChangeCount: changes.filter((change) => change.entry.deploymentTarget === "PAGES").length,
    workerChangeCount: changes.filter((change) => change.entry.deploymentTarget === "WORKER").length,
    changedFiles: [...new Set(changes.map((change) => change.entry.sourcePath))],
    changes
  };
}

function replaceTemplateTokens(value, bindings, transformStatic) {
  const bindingByToken = new Map(bindings.map((binding) => [binding.token, binding.expression]));
  const tokenPattern = new RegExp([...bindingByToken.keys()].sort((a, b) => b.length - a.length).map((token) => token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|"), "gu");
  let output = "";
  let cursor = 0;
  for (const match of value.matchAll(tokenPattern)) {
    output += transformStatic(value.slice(cursor, match.index));
    output += bindingByToken.get(match[0]);
    cursor = match.index + match[0].length;
  }
  return output + transformStatic(value.slice(cursor));
}

function encodeCandidate(candidate, edited) {
  const sourceNewlines = edited.replace(/\n/gu, candidate.sourceNewline ?? "\n");
  if (candidate.syntax === "html-text") return encodeHtmlText(sourceNewlines);
  if (candidate.syntax === "html-attribute") return encodeHtmlAttribute(sourceNewlines, candidate.quote);
  if (candidate.syntax === "js-string" || candidate.syntax === "css-string") return encodeJsString(edited, candidate.quote);
  if (candidate.syntax === "js-html-text") return encodeJsString(encodeHtmlText(edited), candidate.quote);
  if (candidate.syntax === "js-html-attribute") return encodeJsString(encodeHtmlAttribute(edited, candidate.htmlQuote), candidate.quote);
  if (candidate.syntax === "js-template") return replaceTemplateTokens(sourceNewlines, candidate.templateBindings, escapeTemplateStatic);
  if (candidate.syntax === "template-html-text") return replaceTemplateTokens(sourceNewlines, candidate.templateBindings, (value) => escapeTemplateStatic(encodeHtmlText(value)));
  if (candidate.syntax === "template-html-attribute") return replaceTemplateTokens(sourceNewlines, candidate.templateBindings, (value) => escapeTemplateStatic(encodeHtmlAttribute(value, candidate.quote)));
  throw new SiteCopyError("SITE_COPY_APPLY_UNSUPPORTED_CHANGE", "未対応の文字列形式です。", { syntax: candidate.syntax });
}

export function planApply(rootDir, validation) {
  const sourceCache = new Map();
  const plannedByFile = new Map();
  for (const change of validation.changes) {
    let resolved;
    try {
      resolved = resolveEntry(rootDir, change.entry, sourceCache);
    } catch (error) {
      throw new SiteCopyError("SITE_COPY_APPLY_AMBIGUOUS_TARGET", "反映先を一意に解決できません。", { id: change.entry.id, path: change.entry.sourcePath });
    }
    const replacement = encodeCandidate(resolved.candidate, change.after);
    const list = plannedByFile.get(change.entry.sourcePath) ?? [];
    list.push({ id: change.entry.id, start: resolved.candidate.rangeStart, end: resolved.candidate.rangeEnd, replacement });
    plannedByFile.set(change.entry.sourcePath, list);
  }
  for (const [sourcePath, replacements] of plannedByFile) {
    replacements.sort((left, right) => left.start - right.start);
    for (let index = 1; index < replacements.length; index += 1) {
      if (replacements[index].start < replacements[index - 1].end) throw new SiteCopyError("SITE_COPY_APPLY_AMBIGUOUS_TARGET", "反映範囲が重複しています。", { path: sourcePath, count: 2 });
    }
  }
  return { sourceCache, plannedByFile };
}

export function applyChanges(rootDir, validation, options = {}) {
  const { sourceCache, plannedByFile } = planApply(rootDir, validation);
  const originals = new Map();
  const outputs = new Map();
  for (const [sourcePath, replacements] of plannedByFile) {
    const source = sourceCache.get(sourcePath);
    originals.set(sourcePath, source);
    let output = source;
    for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
      output = `${output.slice(0, replacement.start)}${replacement.replacement}${output.slice(replacement.end)}`;
    }
    outputs.set(sourcePath, output);
  }
  let manifestOutput = null;
  let manifestRelativePath = null;
  if (options.manifestPath) {
    const manifestPath = path.resolve(options.manifestPath);
    const relativeManifestPath = path.relative(rootDir, manifestPath);
    if (relativeManifestPath.startsWith("..") || path.isAbsolute(relativeManifestPath)) {
      throw new SiteCopyError("SITE_COPY_APPLY_VALIDATION_FAILED", "manifestはrepository内である必要があります。", { path: "site-copy/site-copy-manifest.json" });
    }
    const manifest = loadManifest(manifestPath);
    const manifestEntries = new Map(manifest.entries.map((entry) => [entry.id, entry]));
    const changesById = new Map(validation.changes.map((change) => [change.entry.id, change]));
    for (const change of validation.changes) {
      const manifestEntry = manifestEntries.get(change.entry.id);
      if (!manifestEntry || manifestEntry.sourceValueSha256 !== change.entry.sourceValueSha256) {
        throw new SiteCopyError("SITE_COPY_APPLY_VALIDATION_FAILED", "repository manifestがsnapshotと一致しません。", { id: change.entry.id });
      }
    }
    for (const manifestEntry of manifest.entries.filter((entry) => outputs.has(entry.sourcePath))) {
      const updatedSource = outputs.get(manifestEntry.sourcePath);
      const matches = scanSource(manifestEntry.sourcePath, updatedSource).filter((candidate) => candidateMatchesStableLocator(candidate, manifestEntry));
      const change = changesById.get(manifestEntry.id);
      const expectedValueSha256 = change ? sha256(change.after) : manifestEntry.sourceValueSha256;
      if (matches.length !== 1 || sha256(matches[0].value) !== expectedValueSha256) {
        throw new SiteCopyError("SITE_COPY_APPLY_AMBIGUOUS_TARGET", "反映後locatorを一意に更新できません。", { id: manifestEntry.id, path: manifestEntry.sourcePath, count: matches.length });
      }
      manifestEntry.locator = matches[0].locator;
      manifestEntry.sourceValueSha256 = expectedValueSha256;
    }
    manifestOutput = canonicalJson(manifest);
    manifestRelativePath = relativeManifestPath.replace(/\\/gu, "/");
    originals.set(manifestRelativePath, fs.readFileSync(manifestPath, "utf8"));
    outputs.set(manifestRelativePath, manifestOutput);
  }
  const written = [];
  try {
    for (const [sourcePath, output] of outputs) {
      fs.writeFileSync(path.join(rootDir, sourcePath), output, "utf8");
      written.push(sourcePath);
    }
  } catch (error) {
    for (const sourcePath of written) fs.writeFileSync(path.join(rootDir, sourcePath), originals.get(sourcePath), "utf8");
    throw new SiteCopyError("SITE_COPY_APPLY_PARTIAL_FAILURE", "反映に失敗したため変更を復元しました。", { fileCount: written.length, errorType: error?.constructor?.name ?? "Error" });
  }
  return { code: "SITE_COPY_APPLY_COMPLETE", changedFiles: [...outputs.keys()], changeCount: validation.changeCount };
}

export function safeDiagnostic(value) {
  const allowed = ["mode", "timestamp", "head", "manifestSha256", "catalogId", "entryCount", "changeCount", "pagesCount", "workerCount", "manualReviewCount", "paths", "ids", "hashes", "lengths", "code", "status", "tests"];
  return Object.fromEntries(Object.entries(value).filter(([key]) => allowed.includes(key)));
}

export function groupCounts(entries) {
  return Object.fromEntries(GROUPS.map((group) => [group, entries.filter((entry) => entry.group === group && !entry.retired).length]));
}
