import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const MANIFEST_VERSION = 2;
export const UI_FILENAME = "BMS差分共有サイト_UI文章編集.txt";
export const GUIDE_FILENAME = "BMS差分共有サイト_ガイド全文編集.txt";
export const CHANGELOG_FILENAME = "BMS差分共有サイト_更新履歴編集.txt";
export const UI_HEADER = "# BMS-WIP UI COPY EDIT v1";
export const GUIDE_HEADER = "# BMS-WIP GUIDE EDIT v1";
export const CHANGELOG_HEADER = "# BMS-WIP CHANGELOG EDIT v1";
export const GUIDE_SECTION_IDS = Object.freeze([
  "GUIDE_INTRO",
  "GUIDE_QUICK_USE",
  "GUIDE_FEATURE_INDEX",
  "GUIDE_POSTING",
  "GUIDE_PROGRESS",
  "GUIDE_DIFFICULTY",
  "GUIDE_MANAGEMENT",
  "GUIDE_SAFETY"
]);
export const LINK_TARGETS = Object.freeze({
  POST_FORM: "./index.html#post",
  LIST: "./list.html",
  RC_STAR: "https://bms-wip-charts-worker.monsta3228gsl.workers.dev/difficulty-tables/rc-star",
  RC_DOUBLE_STAR: "https://bms-wip-charts-worker.monsta3228gsl.workers.dev/difficulty-tables/rc-double-star"
});

const INTERNAL_GUIDE_LINKS = Object.freeze([
  ["#posting", "GUIDE_POSTING"],
  ["#progress", "GUIDE_PROGRESS"],
  ["#difficulty", "GUIDE_DIFFICULTY"],
  ["#management", "GUIDE_MANAGEMENT"],
  ["#safety", "GUIDE_SAFETY"]
]);
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const FORBIDDEN_URL = /(?:https?:\/\/|www\.|javascript\s*:|data\s*:|\.\/|\/api\/)/iu;
const FORBIDDEN_CODE = /(?:<\/?[A-Za-z!]|\b(?:function|const|let|var)\s+[A-Za-z_$]|\b(?:iframe|script|style)\s*[:{(])/iu;

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
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "UTF-8として読み込めません。", { path: filePath });
  }
  return normalizeNewlines(text);
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
  const counts = git(rootDir, ["rev-list", "--left-right", "--count", "origin/main...HEAD"]).split(/\s+/u).map(Number);
  if (counts[0] !== 0) throw new SiteCopyError("SITE_COPY_EXPORT_REPO_INVALID", "origin/mainより遅れています。", { behind: counts[0], ahead: counts[1] });
  return { head, behind: counts[0], ahead: counts[1] };
}

function decodeHtml(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0" };
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/giu, (match, decimal, hex, name) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return named[name.toLowerCase()] ?? match;
  });
}

function encodeHtml(value) {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function findTagEnd(source, start) {
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "\"" || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function findElement(source, locator) {
  const attributeName = locator.elementId
    ? "id"
    : locator.copySection
      ? "data-copy-section"
      : locator.copyEntry
        ? "data-copy-entry"
        : "data-copy-key";
  const attributeValue = locator.elementId ?? locator.copySection ?? locator.copyEntry ?? locator.copyKey;
  const pattern = new RegExp(`<([A-Za-z][\\w:-]*)\\b[^>]*\\b${escapeRegex(attributeName)}\\s*=\\s*(["'])${escapeRegex(attributeValue)}\\2[^>]*>`, "giu");
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) return { matches: matches.length };
  const match = matches[0];
  const tagName = match[1].toLowerCase();
  const openStart = match.index;
  const openEnd = findTagEnd(source, openStart + 1);
  if (openEnd < 0 || VOID_TAGS.has(tagName)) return { matches: 0 };
  let depth = 1;
  let cursor = openEnd + 1;
  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart < 0) break;
    if (source.startsWith("<!--", tagStart)) {
      const commentEnd = source.indexOf("-->", tagStart + 4);
      cursor = commentEnd < 0 ? source.length : commentEnd + 3;
      continue;
    }
    const tagEnd = findTagEnd(source, tagStart + 1);
    if (tagEnd < 0) break;
    const tag = source.slice(tagStart + 1, tagEnd);
    const close = tag.match(/^\s*\/\s*([A-Za-z][\w:-]*)/u);
    const open = tag.match(/^\s*([A-Za-z][\w:-]*)/u);
    if (close?.[1].toLowerCase() === tagName) depth -= 1;
    else if (open?.[1].toLowerCase() === tagName && !/\/\s*$/u.test(tag)) depth += 1;
    if (depth === 0) return { matches: 1, tagName, openStart, openEnd: openEnd + 1, innerStart: openEnd + 1, innerEnd: tagStart, closeEnd: tagEnd + 1 };
    cursor = tagEnd + 1;
  }
  return { matches: 0 };
}

function directTextRanges(source, element) {
  const ranges = [];
  let depth = 0;
  let cursor = element.innerStart;
  while (cursor < element.innerEnd) {
    const tagStart = source.indexOf("<", cursor);
    const textEnd = tagStart < 0 || tagStart > element.innerEnd ? element.innerEnd : tagStart;
    if (depth === 0 && textEnd > cursor) {
      const raw = source.slice(cursor, textEnd);
      const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
      const trailing = raw.match(/\s*$/u)?.[0].length ?? 0;
      if (textEnd - trailing > cursor + leading) ranges.push({ start: cursor + leading, end: textEnd - trailing });
    }
    if (tagStart < 0 || tagStart >= element.innerEnd) break;
    const tagEnd = findTagEnd(source, tagStart + 1);
    if (tagEnd < 0 || tagEnd > element.innerEnd) break;
    const tag = source.slice(tagStart + 1, tagEnd);
    const close = tag.match(/^\s*\/\s*([A-Za-z][\w:-]*)/u);
    const open = tag.match(/^\s*([A-Za-z][\w:-]*)/u);
    if (close) depth = Math.max(0, depth - 1);
    else if (open && !VOID_TAGS.has(open[1].toLowerCase()) && !/\/\s*$/u.test(tag)) depth += 1;
    cursor = tagEnd + 1;
  }
  return ranges;
}

function resolveHtmlField(source, field) {
  const element = findElement(source, field.locator);
  if (element.matches !== 1) return { matches: element.matches ?? 0 };
  let range;
  if (field.locator.mode === "DIRECT_TEXT") {
    const ranges = directTextRanges(source, element);
    range = ranges[(field.locator.textIndex ?? 1) - 1];
  } else {
    const inner = source.slice(element.innerStart, element.innerEnd);
    if (/<[A-Za-z!/]/u.test(inner)) return { matches: 0 };
    const leading = inner.match(/^\s*/u)?.[0].length ?? 0;
    const trailing = inner.match(/\s*$/u)?.[0].length ?? 0;
    range = { start: element.innerStart + leading, end: element.innerEnd - trailing };
  }
  if (!range) return { matches: 0 };
  return { matches: 1, value: normalizeNewlines(decodeHtml(source.slice(range.start, range.end))), rangeStart: range.start, rangeEnd: range.end, syntax: "HTML" };
}

function decodeJsString(raw) {
  let output = "";
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== "\\") {
      output += raw[index];
      continue;
    }
    const escaped = raw[++index];
    if (escaped === undefined) break;
    const simple = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };
    if (Object.hasOwn(simple, escaped)) output += simple[escaped];
    else if (escaped === "u" && raw[index + 1] === "{") {
      const close = raw.indexOf("}", index + 2);
      const code = close >= 0 ? raw.slice(index + 2, close) : "";
      if (/^[0-9a-f]{1,6}$/iu.test(code)) {
        output += String.fromCodePoint(Number.parseInt(code, 16));
        index = close;
      } else output += `\\${escaped}`;
    } else if (escaped === "u" && /^[0-9a-f]{4}$/iu.test(raw.slice(index + 1, index + 5))) {
      output += String.fromCharCode(Number.parseInt(raw.slice(index + 1, index + 5), 16));
      index += 4;
    } else if (escaped === "x" && /^[0-9a-f]{2}$/iu.test(raw.slice(index + 1, index + 3))) {
      output += String.fromCharCode(Number.parseInt(raw.slice(index + 1, index + 3), 16));
      index += 2;
    } else output += escaped;
  }
  return output;
}

function previousSignificant(source, start) {
  return source.slice(Math.max(0, start - 80), start).match(/\S(?=\s*$)/u)?.[0];
}

function looksLikeRegex(source, start) {
  const previous = previousSignificant(source, start);
  return previous == null || /[([{:;,=!?&|+*%^~<>-]/u.test(previous) || /(?:return|throw|case|typeof|instanceof)\s*$/u.test(source.slice(Math.max(0, start - 40), start));
}

function skipQuoted(source, start, quote) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") index += 1;
    else if (source[index] === quote) return index + 1;
  }
  return source.length;
}

function skipRegex(source, start) {
  let inClass = false;
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") index += 1;
    else if (source[index] === "[") inClass = true;
    else if (source[index] === "]") inClass = false;
    else if (source[index] === "/" && !inClass) {
      while (/[A-Za-z]/u.test(source[++index] ?? "")) {}
      return index;
    } else if (source[index] === "\n" || source[index] === "\r") return start + 1;
  }
  return source.length;
}

function normalizeAnchor(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function scanJsStrings(source) {
  const candidates = [];
  for (let cursor = 0, ordinal = 0; cursor < source.length;) {
    if (source.startsWith("//", cursor)) {
      const end = source.indexOf("\n", cursor + 2);
      cursor = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      const end = source.indexOf("*/", cursor + 2);
      cursor = end < 0 ? source.length : end + 2;
      continue;
    }
    if (source[cursor] === "/" && looksLikeRegex(source, cursor)) {
      cursor = skipRegex(source, cursor);
      continue;
    }
    const quote = source[cursor];
    if (quote !== "\"" && quote !== "'") {
      cursor += 1;
      continue;
    }
    const end = skipQuoted(source, cursor, quote);
    const contentStart = cursor + 1;
    const contentEnd = end - 1;
    ordinal += 1;
    const raw = source.slice(contentStart, contentEnd);
    candidates.push({
      ordinal,
      quote,
      raw,
      value: normalizeNewlines(decodeJsString(raw)),
      rangeStart: contentStart,
      rangeEnd: contentEnd,
      beforeAnchorSha256: sha256(normalizeAnchor(source.slice(Math.max(0, contentStart - 120), contentStart))),
      afterAnchorSha256: sha256(normalizeAnchor(source.slice(contentEnd, Math.min(source.length, contentEnd + 120))))
    });
    cursor = end;
  }
  return candidates;
}

function resolveJsField(source, field, stable = false) {
  const candidates = scanJsStrings(source);
  const matches = stable
    ? candidates.filter((candidate) => candidate.ordinal === field.locator.stringOrdinal)
    : candidates.filter((candidate) => candidate.ordinal === field.locator.stringOrdinal && candidate.beforeAnchorSha256 === field.locator.beforeAnchorSha256 && candidate.afterAnchorSha256 === field.locator.afterAnchorSha256);
  if (matches.length !== 1) return { matches: matches.length };
  const candidate = matches[0];
  return { matches: 1, value: candidate.value, rangeStart: candidate.rangeStart, rangeEnd: candidate.rangeEnd, syntax: "JS", quote: candidate.quote, raw: candidate.raw, candidate };
}

function resolveFieldFromSource(source, field, stable = false) {
  return field.sourceType === "HTML_TEXT" ? resolveHtmlField(source, field) : resolveJsField(source, field, stable);
}

export function resolveField(rootDir, field, sourceCache = new Map(), stable = false) {
  let source = sourceCache.get(field.sourcePath);
  if (source === undefined) {
    source = fs.readFileSync(path.join(rootDir, field.sourcePath), "utf8");
    sourceCache.set(field.sourcePath, source);
  }
  const resolved = resolveFieldFromSource(source, field, stable);
  if (resolved.matches !== 1) throw new SiteCopyError("SITE_COPY_GUIDE_BASELINE_MISMATCH", "UI文章の反映先を一意に解決できません。", { blockId: field.blockId, fieldKey: field.key, path: field.sourcePath, count: resolved.matches });
  if (!stable && field.sourceValueSha256 && sha256(resolved.value) !== field.sourceValueSha256) {
    throw new SiteCopyError("SITE_COPY_GUIDE_BASELINE_MISMATCH", "UI文章のsource baselineが一致しません。", { blockId: field.blockId, fieldKey: field.key, path: field.sourcePath });
  }
  return { source, ...resolved };
}

function encodeJs(value, resolved) {
  const unicodeStyle = /\\u(?:\{|[0-9a-f]{4})/iu.test(resolved.raw);
  let output = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (character === "\\") output += "\\\\";
    else if (character === resolved.quote) output += `\\${character}`;
    else if (character === "\n") output += "\\n";
    else if (character === "\r") output += "\\r";
    else if (character === "\t") output += "\\t";
    else if (unicodeStyle && codePoint > 0x7f) {
      if (codePoint <= 0xffff) output += `\\u${codePoint.toString(16).padStart(4, "0")}`;
      else {
        const adjusted = codePoint - 0x10000;
        output += `\\u${(0xd800 + (adjusted >> 10)).toString(16)}\\u${(0xdc00 + (adjusted & 0x3ff)).toString(16)}`;
      }
    } else output += character;
  }
  return output;
}

function encodeFieldValue(value, resolved) {
  return resolved.syntax === "HTML" ? encodeHtml(value) : encodeJs(value, resolved);
}

function parseAttributes(tagSource) {
  const attributes = {};
  for (const match of tagSource.matchAll(/([^\s"'<>/=]+)\s*=\s*(["'])([\s\S]*?)\2/gu)) attributes[match[1].toLowerCase()] = decodeHtml(match[3]);
  return attributes;
}

function parseHtmlFragment(fragment) {
  const root = { tag: "#root", children: [] };
  const stack = [root];
  const pattern = /<!--[\s\S]*?-->|<[^>]+>|[^<]+/gu;
  for (const match of fragment.matchAll(pattern)) {
    const token = match[0];
    if (token.startsWith("<!--")) continue;
    if (!token.startsWith("<")) {
      stack.at(-1).children.push({ tag: "#text", text: decodeHtml(token) });
      continue;
    }
    const close = token.match(/^<\s*\/\s*([A-Za-z][\w:-]*)/u);
    if (close) {
      const name = close[1].toLowerCase();
      for (let index = stack.length - 1; index > 0; index -= 1) {
        const node = stack.pop();
        if (node.tag === name) break;
      }
      continue;
    }
    const open = token.match(/^<\s*([A-Za-z][\w:-]*)/u);
    if (!open) continue;
    const tag = open[1].toLowerCase();
    const node = { tag, attributes: parseAttributes(token), children: [] };
    stack.at(-1).children.push(node);
    if (!VOID_TAGS.has(tag) && !/\/\s*>$/u.test(token)) stack.push(node);
  }
  return root;
}

function collapseInline(value) {
  return value.replace(/[ \t\r\n]+/gu, " ").replace(/\s*\n\s*/gu, "\n").trim();
}

function inlineMarkdown(node) {
  if (node.tag === "#text") return node.text;
  if (node.tag === "br") return "\n";
  const inner = node.children.map(inlineMarkdown).join("");
  if (node.tag !== "a") return inner;
  const linkId = Object.entries(LINK_TARGETS).find(([, href]) => href === node.attributes.href)?.[0];
  return linkId ? `[${collapseInline(inner)}](LINK:${linkId})` : collapseInline(inner);
}

function blockMarkdown(node, blocks) {
  if (node.tag === "#text") return;
  if (/^h[1-3]$/u.test(node.tag)) {
    const level = Number(node.tag[1]);
    const text = collapseInline(node.children.map(inlineMarkdown).join(""));
    if (text) blocks.push(`${"#".repeat(level)} ${text}`);
    return;
  }
  if (node.tag === "p") {
    const text = collapseInline(node.children.map(inlineMarkdown).join(""));
    if (text) blocks.push(text);
    return;
  }
  if (node.tag === "ul" || node.tag === "ol") {
    const prefix = node.tag === "ul" ? "-" : "1.";
    const lines = node.children.filter((child) => child.tag === "li").map((child) => `${prefix} ${collapseInline(child.children.map(inlineMarkdown).join(""))}`);
    if (lines.length > 0) blocks.push(lines.join("\n"));
    return;
  }
  if (node.tag === "nav") {
    const lines = node.children.filter((child) => child.tag === "a").map((child) => `- ${collapseInline(inlineMarkdown(child))}`);
    if (lines.length > 0) blocks.push(lines.join("\n"));
    return;
  }
  if (node.tag === "a") {
    const text = collapseInline(inlineMarkdown(node));
    if (text) blocks.push(text);
    return;
  }
  for (const child of node.children) blockMarkdown(child, blocks);
}

export function htmlToGuideMarkdown(fragment) {
  const root = parseHtmlFragment(fragment);
  const blocks = [];
  for (const child of root.children) blockMarkdown(child, blocks);
  return `${blocks.join("\n\n").trim()}\n`;
}

export function resolveGuideSection(rootDir, section, sourceCache = new Map()) {
  let source = sourceCache.get(section.sourcePath);
  if (source === undefined) {
    source = fs.readFileSync(path.join(rootDir, section.sourcePath), "utf8");
    sourceCache.set(section.sourcePath, source);
  }
  const element = findElement(source, { copySection: section.id });
  if (element.matches !== 1) throw new SiteCopyError("SITE_COPY_GUIDE_BASELINE_MISMATCH", "guide sectionを一意に解決できません。", { sectionId: section.id, path: section.sourcePath, count: element.matches ?? 0 });
  const markdown = htmlToGuideMarkdown(source.slice(element.innerStart, element.innerEnd));
  if (section.sourceValueSha256 && sha256(markdown) !== section.sourceValueSha256) {
    throw new SiteCopyError("SITE_COPY_GUIDE_BASELINE_MISMATCH", "guide sectionのsource baselineが一致しません。", { sectionId: section.id, path: section.sourcePath });
  }
  return { source, element, markdown };
}

function descendantNodes(node, tagName, output = []) {
  if (node.tag === tagName) output.push(node);
  for (const child of node.children ?? []) descendantNodes(child, tagName, output);
  return output;
}

function nodeText(node) {
  if (node.tag === "#text") return node.text;
  return (node.children ?? []).map(nodeText).join("");
}

export function htmlToChangelogMarkdown(fragment, entry) {
  const root = parseHtmlFragment(fragment);
  const times = descendantNodes(root, "time");
  const titles = descendantNodes(root, "h2");
  const content = root.children.find((node) => node.tag === "div");
  if (times.length !== 1 || titles.length !== 1 || !content) {
    throw new SiteCopyError("SITE_COPY_GUIDE_BASELINE_MISMATCH", "更新履歴entryの構造が不正です。", { entryId: entry.id });
  }
  const displayDate = collapseInline(nodeText(times[0]));
  const datetime = times[0].attributes.datetime;
  if (!/^\d{4}\/\d{2}\/\d{2}$/u.test(displayDate) || datetime !== displayDate.replaceAll("/", "-")) {
    throw new SiteCopyError("SITE_COPY_GUIDE_BASELINE_MISMATCH", "更新履歴entryの日付が不正です。", { entryId: entry.id });
  }
  const title = collapseInline(titles[0].children.map(inlineMarkdown).join(""));
  const blocks = [];
  for (const child of content.children) {
    if (child === titles[0]) continue;
    blockMarkdown(child, blocks);
  }
  return `## ${displayDate}\n\n### ${title}\n\n${blocks.join("\n\n").trim()}\n`;
}

export function resolveChangelogEntry(rootDir, entry, sourceCache = new Map()) {
  let source = sourceCache.get(entry.sourcePath);
  if (source === undefined) {
    source = fs.readFileSync(path.join(rootDir, entry.sourcePath), "utf8");
    sourceCache.set(entry.sourcePath, source);
  }
  const element = findElement(source, { copyEntry: entry.id });
  if (element.matches !== 1) {
    throw new SiteCopyError("SITE_COPY_GUIDE_BASELINE_MISMATCH", "更新履歴entryを一意に解決できません。", { entryId: entry.id, path: entry.sourcePath, count: element.matches ?? 0 });
  }
  const markdown = htmlToChangelogMarkdown(source.slice(element.innerStart, element.innerEnd), entry);
  if (entry.sourceValueSha256 && sha256(markdown) !== entry.sourceValueSha256) {
    throw new SiteCopyError("SITE_COPY_GUIDE_BASELINE_MISMATCH", "更新履歴entryのsource baselineが一致しません。", { entryId: entry.id, path: entry.sourcePath });
  }
  return { source, element, markdown };
}

function linkIds(markdown) {
  return [...markdown.matchAll(/\[[^\]\n]+\]\(LINK:([A-Z][A-Z0-9_]*)\)/gu)].map((match) => match[1]);
}

function counts(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function sameCounts(left, right) {
  const keys = new Set([...left.keys(), ...right.keys()]);
  return [...keys].every((key) => left.get(key) === right.get(key));
}

function validateEditableText(value, detail, guide = false) {
  if (FORBIDDEN_CODE.test(value) || /<|>/u.test(value)) throw new SiteCopyError("SITE_COPY_GUIDE_HTML_FORBIDDEN", "HTMLまたは実行コードは使用できません。", detail);
  const withoutAllowedLinks = value.replace(/\[[^\]\n]+\]\(LINK:[A-Z][A-Z0-9_]*\)/gu, "");
  if (FORBIDDEN_URL.test(withoutAllowedLinks)) throw new SiteCopyError("SITE_COPY_GUIDE_URL_FORBIDDEN", "任意URLは使用できません。", detail);
  if (guide && /\]\(LINK:|\(LINK:|LINK:/u.test(withoutAllowedLinks)) throw new SiteCopyError("SITE_COPY_GUIDE_LINK_INVALID", "LINK記法が不正です。", detail);
}

function renderInline(value) {
  let output = "";
  let cursor = 0;
  const pattern = /\[([^\]\n]+)\]\(LINK:([A-Z][A-Z0-9_]*)\)/gu;
  for (const match of value.matchAll(pattern)) {
    output += encodeHtml(value.slice(cursor, match.index));
    const href = LINK_TARGETS[match[2]];
    if (!href) throw new SiteCopyError("SITE_COPY_GUIDE_LINK_INVALID", "未知のLINK識別子です。", { linkId: match[2] });
    output += `<a href="${encodeHtml(href)}">${encodeHtml(match[1])}</a>`;
    cursor = match.index + match[0].length;
  }
  return output + encodeHtml(value.slice(cursor));
}

function parseGuideMarkdown(markdown, section) {
  const lines = normalizeNewlines(markdown).trim().split("\n");
  const blocks = [];
  let cursor = 0;
  while (cursor < lines.length) {
    if (lines[cursor].trim() === "") {
      cursor += 1;
      continue;
    }
    const heading = lines[cursor].match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      cursor += 1;
      continue;
    }
    if (/^-\s+/u.test(lines[cursor])) {
      const items = [];
      while (cursor < lines.length && /^-\s+/u.test(lines[cursor])) items.push(lines[cursor++].replace(/^-\s+/u, ""));
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/u.test(lines[cursor])) {
      const items = [];
      while (cursor < lines.length && /^\d+\.\s+/u.test(lines[cursor])) items.push(lines[cursor++].replace(/^\d+\.\s+/u, ""));
      blocks.push({ type: "ol", items });
      continue;
    }
    const paragraph = [];
    while (cursor < lines.length && lines[cursor].trim() !== "" && !/^(?:#{1,3}\s+|-\s+|\d+\.\s+)/u.test(lines[cursor])) paragraph.push(lines[cursor++].trim());
    if (paragraph.length === 0) throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "ガイド原稿を解析できません。", { sectionId: section.id });
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

function renderGuideBlock(block, section, state, options = {}) {
  if (block.type === "heading") {
    const firstId = state.firstHeading && section.headingId ? section.headingId : null;
    state.firstHeading = false;
    const headingId = options.headingId ?? firstId;
    const id = headingId ? ` id="${encodeHtml(headingId)}"` : "";
    return `<h${block.level}${id}>${renderInline(block.text)}</h${block.level}>`;
  }
  if (block.type === "ul") return `<ul>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`;
  if (block.type === "ol") return `<ol>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`;
  const labelClass = state.beforeFirstHeading && options.label !== false ? " class=\"work-ticket-label\"" : "";
  const standaloneLink = options.standaloneLink && /^\[[^\]\n]+\]\(LINK:[A-Z][A-Z0-9_]*\)$/u.test(block.text);
  return standaloneLink ? renderInline(block.text) : `<p${labelClass}>${renderInline(block.text)}</p>`;
}

function renderGuideBlocks(blocks, section, state = { firstHeading: true, beforeFirstHeading: true }, options = {}) {
  return blocks.map((block) => {
    const rendered = renderGuideBlock(block, section, state, options);
    if (block.type === "heading") state.beforeFirstHeading = false;
    return rendered;
  }).join("\n");
}

function splitHeadingGroups(blocks) {
  const first = blocks.findIndex((block) => block.type === "heading" && block.level === 3);
  if (first < 0) return { preamble: blocks, groups: [] };
  const preamble = blocks.slice(0, first);
  const groups = [];
  for (const block of blocks.slice(first)) {
    if (block.type === "heading" && block.level === 3) groups.push([block]);
    else groups.at(-1).push(block);
  }
  return { preamble, groups };
}

export function guideMarkdownToHtml(markdown, section) {
  const blocks = parseGuideMarkdown(markdown, section);
  const state = { firstHeading: true, beforeFirstHeading: true };
  if (section.id === "GUIDE_FEATURE_INDEX") {
    const listIndex = blocks.findIndex((block) => block.type === "ul");
    if (listIndex < 0 || blocks[listIndex].items.length !== INTERNAL_GUIDE_LINKS.length || blocks.slice(listIndex + 1).some((block) => block.type === "ul")) {
      throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "機能索引は5項目を維持してください。", { sectionId: section.id, count: listIndex < 0 ? 0 : blocks[listIndex].items.length });
    }
    const before = renderGuideBlocks(blocks.slice(0, listIndex), section, state);
    const nav = `<nav class="guide-index" aria-label="各機能の概要">${blocks[listIndex].items.map((item, index) => `<a href="${INTERNAL_GUIDE_LINKS[index][0]}">${renderInline(item)}</a>`).join("")}</nav>`;
    const after = renderGuideBlocks(blocks.slice(listIndex + 1), section, state);
    return [before, nav, after].filter(Boolean).join("\n");
  }
  if (section.id === "GUIDE_QUICK_USE") {
    const { preamble, groups } = splitHeadingGroups(blocks);
    if (groups.length > 0) {
      const before = renderGuideBlocks(preamble, section, state);
      const articles = groups.map((group) => `<article class="quick-use-item">${renderGuideBlocks(group, section, state, { standaloneLink: true, label: false })}</article>`).join("\n");
      return `${before}\n<div class="quick-use-grid">\n${articles}\n</div>`;
    }
  }
  if (section.id === "GUIDE_MANAGEMENT") {
    const { preamble, groups } = splitHeadingGroups(blocks);
    if (groups.length > 0) {
      const before = renderGuideBlocks(preamble, section, state);
      let callout = null;
      const lastGroup = groups.at(-1);
      if (lastGroup.length > 2 && lastGroup.at(-1).type === "paragraph") callout = lastGroup.pop();
      const articles = groups.map((group) => `<article class="guide-info-block">${renderGuideBlocks(group, section, state, { label: false })}</article>`).join("\n");
      const trailing = callout ? `\n<p class="guide-callout">${renderInline(callout.text)}</p>` : "";
      return `${before}\n<div class="guide-info-grid">\n${articles}\n</div>${trailing}`;
    }
  }
  if (section.id === "GUIDE_SAFETY") {
    const { preamble, groups } = splitHeadingGroups(blocks);
    if (groups.length > 0) {
      const before = renderGuideBlocks(preamble, section, state);
      const existingIds = ["passwordSafetyTitle", "sourceInfoTitle", "postingProtectionTitle"];
      const sections = groups.map((group, index) => {
        const headingId = existingIds[index] ?? `guideSafetyTitle${index + 1}`;
        const heading = renderGuideBlock(group[0], section, state, { headingId, label: false });
        state.beforeFirstHeading = false;
        const content = renderGuideBlocks(group.slice(1), section, state, { label: false });
        return `<section aria-labelledby="${headingId}">${heading}${content ? `\n${content}` : ""}</section>`;
      }).join("\n");
      return `${before}\n<div class="guide-safety-list">\n${sections}\n</div>`;
    }
  }
  return renderGuideBlocks(blocks, section, state);
}

function parseChangelogMarkdown(markdown, entry) {
  const blocks = parseGuideMarkdown(markdown, entry);
  const dateHeading = blocks[0];
  const titleHeading = blocks[1];
  if (dateHeading?.type !== "heading" || dateHeading.level !== 2 || !/^\d{4}\/\d{2}\/\d{2}$/u.test(dateHeading.text)
    || titleHeading?.type !== "heading" || titleHeading.level !== 3 || blocks.length < 3
    || blocks.slice(2).some((block) => block.type === "heading")) {
    throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "更新履歴entryは日付、見出し、本文の順で記述してください。", { entryId: entry.id });
  }
  const isoDate = dateHeading.text.replaceAll("/", "-");
  const [year, month, day] = isoDate.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() + 1 !== month || parsedDate.getUTCDate() !== day
    || isoDate > new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())) {
    throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "更新履歴entryの日付が不正です。", { entryId: entry.id });
  }
  return { displayDate: dateHeading.text, isoDate, title: titleHeading.text, content: blocks.slice(2) };
}

export function changelogMarkdownToHtml(markdown, entry) {
  const parsed = parseChangelogMarkdown(markdown, entry);
  const body = parsed.content.map((block) => {
    if (block.type === "ul") return `<ul>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`;
    if (block.type === "ol") return `<ol>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`;
    return `<p>${renderInline(block.text)}</p>`;
  }).join("\n");
  return `<p class="changelog-date"><time datetime="${parsed.isoDate}">${parsed.displayDate}</time></p>\n<div>\n  <h2>${renderInline(parsed.title)}</h2>\n${indentHtml(body, "  ")}\n</div>`;
}

function blockHash(fields) {
  return sha256(fields.map((field) => `${field.key}\0${field.sourceValueSha256}`).join("\n"));
}

export function initializeManifest(rootDir, definition) {
  const manifest = structuredClone(definition);
  const cache = new Map();
  for (const block of manifest.uiBlocks) {
    for (const field of block.fields) {
      field.blockId = block.id;
      if (field.sourceType === "JS_LITERAL" && field.matchValue !== undefined) {
        let source = cache.get(field.sourcePath);
        if (source === undefined) {
          source = fs.readFileSync(path.join(rootDir, field.sourcePath), "utf8");
          cache.set(field.sourcePath, source);
        }
        const matches = scanJsStrings(source).filter((candidate) => candidate.value === field.matchValue);
        const candidate = matches[(field.matchOccurrence ?? 1) - 1];
        if (!candidate) throw new Error(`Cannot initialize ${block.id}.${field.key}`);
        field.locator = { stringOrdinal: candidate.ordinal, beforeAnchorSha256: candidate.beforeAnchorSha256, afterAnchorSha256: candidate.afterAnchorSha256 };
        delete field.matchValue;
        delete field.matchOccurrence;
      }
      const resolved = resolveField(rootDir, field, cache, true);
      field.sourceValueSha256 = sha256(resolved.value);
    }
    block.sourceValueSha256 = blockHash(block.fields);
  }
  for (const section of manifest.guideSections) {
    const resolved = resolveGuideSection(rootDir, section, cache);
    section.sourceValueSha256 = sha256(resolved.markdown);
    section.allowedLinks = [...new Set(linkIds(resolved.markdown))];
  }
  for (const entry of manifest.changelogEntries ?? []) {
    const resolved = resolveChangelogEntry(rootDir, entry, cache);
    entry.sourceValueSha256 = sha256(resolved.markdown);
  }
  return manifest;
}

export function loadManifest(filePath) {
  const manifest = JSON.parse(readUtf8(filePath));
  if (manifest.manifestVersion !== MANIFEST_VERSION || !Array.isArray(manifest.uiBlocks)
    || !Array.isArray(manifest.guideSections)) {
    throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "block manifest schemaに対応していません。", { manifestVersion: manifest.manifestVersion });
  }
  manifest.changelogEntries ??= [];
  if (!Array.isArray(manifest.changelogEntries)) {
    throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "更新履歴entry定義が不正です。", {});
  }
  return manifest;
}

export function assertManifest(rootDir, manifest) {
  const ids = new Set();
  const cache = new Map();
  for (const block of manifest.uiBlocks) {
    if (ids.has(block.id)) throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "block IDが重複しています。", { blockId: block.id });
    ids.add(block.id);
    for (const field of block.fields) {
      field.blockId = block.id;
      const resolved = resolveField(rootDir, field, cache);
      if (sha256(resolved.value) !== field.sourceValueSha256) throw new SiteCopyError("SITE_COPY_GUIDE_BASELINE_MISMATCH", "UI文章hashが一致しません。", { blockId: block.id, fieldKey: field.key });
    }
    if (blockHash(block.fields) !== block.sourceValueSha256) throw new SiteCopyError("SITE_COPY_GUIDE_BASELINE_MISMATCH", "UI block hashが一致しません。", { blockId: block.id });
  }
  const guideIds = manifest.guideSections.map((section) => section.id);
  if (guideIds.length !== GUIDE_SECTION_IDS.length || GUIDE_SECTION_IDS.some((id) => !guideIds.includes(id))) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_MISSING", "guide section定義が不足しています。", { count: guideIds.length });
  for (const section of manifest.guideSections) resolveGuideSection(rootDir, section, cache);
  const changelogIds = new Set();
  for (const entry of manifest.changelogEntries) {
    if (!/^CHANGELOG_\d{8}(?:_[A-Z0-9_]+)?$/u.test(entry.id) || changelogIds.has(entry.id)) {
      throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "更新履歴entry IDが不正または重複しています。", { entryId: entry.id });
    }
    changelogIds.add(entry.id);
    resolveChangelogEntry(rootDir, entry, cache);
  }
  return cache;
}

function buildUiTxt(snapshot) {
  const lines = [UI_HEADER, `BASE_COMMIT: ${snapshot.baseCommit}`, `CATALOG_ID: ${snapshot.catalogId}`, `BLOCK_COUNT: ${snapshot.uiBlocks.length}`, ""];
  for (const block of snapshot.uiBlocks) {
    lines.push(`<!-- BLOCK: ${block.id} -->`);
    for (const field of block.fields) lines.push(`[${field.label}]`, field.currentValue, `[/${field.label}]`, "");
    lines.push(`<!-- END BLOCK: ${block.id} -->`, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildGuideTxt(snapshot) {
  const lines = [GUIDE_HEADER, `BASE_COMMIT: ${snapshot.baseCommit}`, `CATALOG_ID: ${snapshot.catalogId}`, ""];
  for (const section of snapshot.guideSections) lines.push(`<!-- SECTION: ${section.id} -->`, "", section.currentMarkdown.trimEnd(), "", `<!-- END SECTION: ${section.id} -->`, "", "");
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildChangelogTxt(snapshot) {
  const lines = [CHANGELOG_HEADER, `BASE_COMMIT: ${snapshot.baseCommit}`, `CATALOG_ID: ${snapshot.catalogId}`, ""];
  for (const entry of snapshot.changelogEntries) lines.push(`<!-- ENTRY: ${entry.id} -->`, "", entry.currentMarkdown.trimEnd(), "", `<!-- END ENTRY: ${entry.id} -->`, "", "");
  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildExport(rootDir, manifest, exportedAt = new Date().toISOString()) {
  const cache = assertManifest(rootDir, manifest);
  const baseCommit = git(rootDir, ["rev-parse", "HEAD"]);
  const uiBlocks = manifest.uiBlocks.map((block) => ({
    ...block,
    fields: block.fields.map((field) => ({ ...field, currentValue: resolveField(rootDir, field, cache).value }))
  }));
  const guideSections = manifest.guideSections.map((section) => ({ ...section, currentMarkdown: resolveGuideSection(rootDir, section, cache).markdown }));
  const changelogEntries = manifest.changelogEntries.map((entry) => ({ ...entry, currentMarkdown: resolveChangelogEntry(rootDir, entry, cache).markdown }));
  const snapshot = { manifestVersion: MANIFEST_VERSION, catalogId: manifest.catalogId, baseCommit, exportedAt, uiBlocks, guideSections, changelogEntries };
  const snapshotText = canonicalJson(snapshot);
  return { snapshot, snapshotText, snapshotSha256: sha256(snapshotText), uiTxt: buildUiTxt(snapshot), guideTxt: buildGuideTxt(snapshot), changelogTxt: buildChangelogTxt(snapshot) };
}

function parseHeader(lines, expected) {
  if (lines[0] !== expected) throw new SiteCopyError("SITE_COPY_GUIDE_INVALID_HEADER", "TXT headerが不正です。", {});
  const baseCommit = lines[1]?.match(/^BASE_COMMIT: ([0-9a-f]{40})$/u)?.[1];
  const catalogId = lines[2]?.match(/^CATALOG_ID: ([0-9a-f-]+)$/iu)?.[1];
  if (!baseCommit || !catalogId) throw new SiteCopyError("SITE_COPY_GUIDE_INVALID_HEADER", "TXT header metadataが不正です。", {});
  return { baseCommit, catalogId };
}

export function parseUiTxt(text) {
  const lines = normalizeNewlines(text).trimEnd().split("\n");
  const header = parseHeader(lines, UI_HEADER);
  header.blockCount = Number(lines[3]?.match(/^BLOCK_COUNT: (\d+)$/u)?.[1]);
  if (!Number.isSafeInteger(header.blockCount)) throw new SiteCopyError("SITE_COPY_GUIDE_INVALID_HEADER", "UI TXTのBLOCK_COUNTが不正です。", {});
  const blocks = [];
  const seen = new Set();
  let cursor = 4;
  while (cursor < lines.length) {
    if (lines[cursor] === "") { cursor += 1; continue; }
    const start = lines[cursor].match(/^<!-- BLOCK: ([A-Z0-9_]+) -->$/u);
    if (!start) throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "UI block markerが不正です。", { near: blocks.at(-1)?.id ?? "HEADER" });
    const id = start[1];
    if (seen.has(id)) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_DUPLICATE", "UI blockが重複しています。", { blockId: id });
    seen.add(id);
    cursor += 1;
    const fields = [];
    while (cursor < lines.length && lines[cursor] !== `<!-- END BLOCK: ${id} -->`) {
      if (lines[cursor] === "") { cursor += 1; continue; }
      const fieldStart = lines[cursor].match(/^\[([^\]\n]+)\]$/u);
      if (!fieldStart || fieldStart[1].startsWith("/")) throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "UI field markerが不正です。", { blockId: id });
      const label = fieldStart[1];
      cursor += 1;
      const value = [];
      while (cursor < lines.length && lines[cursor] !== `[/${label}]`) value.push(lines[cursor++]);
      if (lines[cursor] !== `[/${label}]`) throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "UI field終端がありません。", { blockId: id, label });
      fields.push({ label, value: value.join("\n") });
      cursor += 1;
    }
    if (lines[cursor] !== `<!-- END BLOCK: ${id} -->`) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_UNTERMINATED", "UI block終端がありません。", { blockId: id });
    blocks.push({ id, fields });
    cursor += 1;
  }
  if (header.blockCount !== blocks.length) throw new SiteCopyError("SITE_COPY_GUIDE_INVALID_HEADER", "UI TXTのBLOCK_COUNTが一致しません。", { expectedCount: header.blockCount, actualCount: blocks.length });
  return { header, blocks };
}

export function parseGuideTxt(text) {
  const lines = normalizeNewlines(text).trimEnd().split("\n");
  const header = parseHeader(lines, GUIDE_HEADER);
  const sections = [];
  const seen = new Set();
  let cursor = 3;
  while (cursor < lines.length) {
    if (lines[cursor] === "") { cursor += 1; continue; }
    const start = lines[cursor].match(/^<!-- SECTION: ([A-Z0-9_]+) -->$/u);
    if (!start) throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "SECTION markerが不正です。", { near: sections.at(-1)?.id ?? "HEADER" });
    const id = start[1];
    if (seen.has(id)) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_DUPLICATE", "SECTIONが重複しています。", { sectionId: id });
    seen.add(id);
    cursor += 1;
    if (lines[cursor] === "") cursor += 1;
    const content = [];
    while (cursor < lines.length && lines[cursor] !== `<!-- END SECTION: ${id} -->`) content.push(lines[cursor++]);
    if (lines[cursor] !== `<!-- END SECTION: ${id} -->`) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_UNTERMINATED", "END SECTIONがありません。", { sectionId: id });
    sections.push({ id, markdown: `${content.join("\n").trim()}\n` });
    cursor += 1;
  }
  return { header, sections };
}

export function parseChangelogTxt(text) {
  const lines = normalizeNewlines(text).trimEnd().split("\n");
  const header = parseHeader(lines, CHANGELOG_HEADER);
  const entries = [];
  const seen = new Set();
  let cursor = 3;
  while (cursor < lines.length) {
    if (lines[cursor] === "") { cursor += 1; continue; }
    const start = lines[cursor].match(/^<!-- ENTRY: (CHANGELOG_\d{8}(?:_[A-Z0-9_]+)?) -->$/u);
    if (!start) throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "ENTRY markerが不正です。", { near: entries.at(-1)?.id ?? "HEADER" });
    const id = start[1];
    if (seen.has(id)) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_DUPLICATE", "ENTRYが重複しています。", { entryId: id });
    seen.add(id);
    cursor += 1;
    if (lines[cursor] === "") cursor += 1;
    const content = [];
    while (cursor < lines.length && lines[cursor] !== `<!-- END ENTRY: ${id} -->`) content.push(lines[cursor++]);
    if (lines[cursor] !== `<!-- END ENTRY: ${id} -->`) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_UNTERMINATED", "END ENTRYがありません。", { entryId: id });
    entries.push({ id, markdown: `${content.join("\n").trim()}\n` });
    cursor += 1;
  }
  return { header, entries };
}

function assertHeaders(parsed, snapshot) {
  if (parsed.header.catalogId !== snapshot.catalogId) throw new SiteCopyError("SITE_COPY_GUIDE_CATALOG_MISMATCH", "CATALOG_IDが一致しません。", {});
  if (parsed.header.baseCommit !== snapshot.baseCommit) throw new SiteCopyError("SITE_COPY_GUIDE_BASELINE_MISMATCH", "BASE_COMMITが一致しません。", {});
}

export function validateEditedCopies(uiText, guideText, snapshot, options = {}) {
  const ui = parseUiTxt(uiText);
  const guide = parseGuideTxt(guideText);
  const changelog = parseChangelogTxt(options.changelogText ?? "");
  assertHeaders(ui, snapshot);
  assertHeaders(guide, snapshot);
  assertHeaders(changelog, snapshot);
  const uiExpected = new Map(snapshot.uiBlocks.map((block) => [block.id, block]));
  if (ui.header.blockCount !== snapshot.uiBlocks.length) throw new SiteCopyError("SITE_COPY_GUIDE_INVALID_HEADER", "UI TXTのBLOCK_COUNTがsnapshotと一致しません。", { expectedCount: snapshot.uiBlocks.length, actualCount: ui.header.blockCount });
  const uiIds = new Set(ui.blocks.map((block) => block.id));
  const missingBlocks = [...uiExpected.keys()].filter((id) => !uiIds.has(id));
  if (missingBlocks.length > 0) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_MISSING", "UI blockが不足しています。", { ids: missingBlocks });
  const unknownBlocks = [...uiIds].filter((id) => !uiExpected.has(id));
  if (unknownBlocks.length > 0) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_UNKNOWN", "未知のUI blockがあります。", { ids: unknownBlocks });
  const uiChanges = [];
  for (const editedBlock of ui.blocks) {
    const expectedBlock = uiExpected.get(editedBlock.id);
    if (editedBlock.fields.length !== expectedBlock.fields.length) throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "UI field数が一致しません。", { blockId: editedBlock.id });
    const fieldChanges = [];
    for (let index = 0; index < expectedBlock.fields.length; index += 1) {
      const expectedField = expectedBlock.fields[index];
      const editedField = editedBlock.fields[index];
      if (editedField.label !== expectedField.label) throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "UI field名が変更されています。", { blockId: editedBlock.id, label: editedField.label });
      if (!expectedField.allowEmpty && editedField.value.length === 0) throw new SiteCopyError("SITE_COPY_GUIDE_PARSE_FAILED", "UI文章を空欄にできません。", { blockId: editedBlock.id, fieldKey: expectedField.key });
      validateEditableText(editedField.value, { blockId: editedBlock.id, fieldKey: expectedField.key });
      if (editedField.value !== expectedField.currentValue) fieldChanges.push({ field: expectedField, before: expectedField.currentValue, after: editedField.value });
    }
    if (fieldChanges.length > 0) uiChanges.push({ block: expectedBlock, fields: fieldChanges });
  }
  const guideExpected = new Map(snapshot.guideSections.map((section) => [section.id, section]));
  const guideIds = new Set(guide.sections.map((section) => section.id));
  const missing = GUIDE_SECTION_IDS.filter((id) => !guideIds.has(id));
  if (missing.length > 0) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_MISSING", "guide SECTIONが不足しています。", { ids: missing });
  const unknown = [...guideIds].filter((id) => !guideExpected.has(id));
  if (unknown.length > 0) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_UNKNOWN", "未知のguide SECTIONがあります。", { ids: unknown });
  const guideChanges = [];
  for (const edited of guide.sections) {
    const expected = guideExpected.get(edited.id);
    validateEditableText(edited.markdown, { sectionId: edited.id }, true);
    const ids = linkIds(edited.markdown);
    if (ids.some((id) => !Object.hasOwn(LINK_TARGETS, id)) || !sameCounts(counts(ids), counts(linkIds(expected.currentMarkdown)))) {
      throw new SiteCopyError("SITE_COPY_GUIDE_LINK_INVALID", "LINK識別子が変更されています。", { sectionId: edited.id });
    }
    guideMarkdownToHtml(edited.markdown, expected);
    if (edited.markdown !== expected.currentMarkdown) guideChanges.push({ section: expected, before: expected.currentMarkdown, after: edited.markdown });
  }
  const changelogExpected = new Map(snapshot.changelogEntries.map((entry) => [entry.id, entry]));
  const changelogIds = new Set(changelog.entries.map((entry) => entry.id));
  const missingEntries = [...changelogExpected.keys()].filter((id) => !changelogIds.has(id));
  if (missingEntries.length > 0) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_MISSING", "更新履歴ENTRYが不足しています。", { ids: missingEntries });
  const unknownEntries = [...changelogIds].filter((id) => !changelogExpected.has(id));
  if (unknownEntries.length > 0) throw new SiteCopyError("SITE_COPY_GUIDE_SECTION_UNKNOWN", "未知の更新履歴ENTRYがあります。", { ids: unknownEntries });
  const changelogChanges = [];
  for (const edited of changelog.entries) {
    const expected = changelogExpected.get(edited.id);
    validateEditableText(edited.markdown, { entryId: edited.id }, true);
    changelogMarkdownToHtml(edited.markdown, expected);
    if (edited.markdown !== expected.currentMarkdown) changelogChanges.push({ entry: expected, before: expected.currentMarkdown, after: edited.markdown });
  }
  if (options.rootDir) {
    const cache = new Map();
    for (const block of snapshot.uiBlocks) for (const field of block.fields) resolveField(options.rootDir, field, cache);
    for (const section of snapshot.guideSections) resolveGuideSection(options.rootDir, section, cache);
    for (const entry of snapshot.changelogEntries) resolveChangelogEntry(options.rootDir, entry, cache);
  }
  return {
    code: "SITE_COPY_GUIDE_DRY_RUN_COMPLETE",
    uiBlockCount: ui.blocks.length,
    guideSectionCount: guide.sections.length,
    uiChangeCount: uiChanges.length,
    uiFieldChangeCount: uiChanges.reduce((sum, block) => sum + block.fields.length, 0),
    guideChangeCount: guideChanges.length,
    changelogEntryCount: changelog.entries.length,
    changelogChangeCount: changelogChanges.length,
    changedFiles: [...new Set([...uiChanges.flatMap((change) => change.fields.map((field) => field.field.sourcePath)), ...guideChanges.map((change) => change.section.sourcePath), ...changelogChanges.map((change) => change.entry.sourcePath)])],
    uiChanges,
    guideChanges,
    changelogChanges
  };
}

function indentHtml(html, indent) {
  return html.split("\n").map((line) => `${indent}${line}`).join("\n");
}

function planCopyApply(rootDir, validation) {
  const sourceCache = new Map();
  const replacements = new Map();
  for (const blockChange of validation.uiChanges) {
    for (const change of blockChange.fields) {
      const resolved = resolveField(rootDir, change.field, sourceCache);
      const list = replacements.get(change.field.sourcePath) ?? [];
      list.push({ start: resolved.rangeStart, end: resolved.rangeEnd, value: encodeFieldValue(change.after, resolved), id: `${blockChange.block.id}.${change.field.key}` });
      replacements.set(change.field.sourcePath, list);
    }
  }
  for (const change of validation.guideChanges) {
    const resolved = resolveGuideSection(rootDir, change.section, sourceCache);
    const lineStart = resolved.source.lastIndexOf("\n", resolved.element.innerStart - 1) + 1;
    const openIndent = resolved.source.slice(lineStart, resolved.element.openStart).match(/^\s*/u)?.[0] ?? "";
    const childIndent = `${openIndent}  `;
    const html = guideMarkdownToHtml(change.after, change.section);
    const value = `\n${indentHtml(html, childIndent)}\n${openIndent}`;
    const list = replacements.get(change.section.sourcePath) ?? [];
    list.push({ start: resolved.element.innerStart, end: resolved.element.innerEnd, value, id: change.section.id });
    replacements.set(change.section.sourcePath, list);
  }
  for (const change of validation.changelogChanges) {
    const resolved = resolveChangelogEntry(rootDir, change.entry, sourceCache);
    const lineStart = resolved.source.lastIndexOf("\n", resolved.element.innerStart - 1) + 1;
    const openIndent = resolved.source.slice(lineStart, resolved.element.openStart).match(/^\s*/u)?.[0] ?? "";
    const childIndent = `${openIndent}  `;
    const html = changelogMarkdownToHtml(change.after, change.entry);
    const value = `\n${indentHtml(html, childIndent)}\n${openIndent}`;
    const list = replacements.get(change.entry.sourcePath) ?? [];
    list.push({ start: resolved.element.innerStart, end: resolved.element.innerEnd, value, id: change.entry.id });
    replacements.set(change.entry.sourcePath, list);
  }
  const outputs = new Map();
  for (const [sourcePath, items] of replacements) {
    items.sort((left, right) => left.start - right.start);
    for (let index = 1; index < items.length; index += 1) if (items[index].start < items[index - 1].end) throw new SiteCopyError("SITE_COPY_GUIDE_APPLY_FAILED", "反映範囲が重複しています。", { path: sourcePath, count: 2 });
    let output = sourceCache.get(sourcePath);
    for (const item of [...items].sort((left, right) => right.start - left.start)) output = `${output.slice(0, item.start)}${item.value}${output.slice(item.end)}`;
    outputs.set(sourcePath, output);
  }
  return { sourceCache, replacements, outputs };
}

export function applyEditedCopies(rootDir, manifestPath, validation, options = {}) {
  const { sourceCache, outputs } = planCopyApply(rootDir, validation);
  const manifest = loadManifest(manifestPath);
  const uiChangesByKey = new Map(validation.uiChanges.flatMap((block) => block.fields.map((change) => [`${block.block.id}.${change.field.key}`, change])));
  for (const block of manifest.uiBlocks) {
    for (const field of block.fields) {
      field.blockId = block.id;
      if (!outputs.has(field.sourcePath)) continue;
      const resolved = resolveFieldFromSource(outputs.get(field.sourcePath), field, true);
      const change = uiChangesByKey.get(`${block.id}.${field.key}`);
      const expected = change?.after;
      if (resolved.matches !== 1 || (expected !== undefined && resolved.value !== expected)) throw new SiteCopyError("SITE_COPY_GUIDE_APPLY_FAILED", "反映後のUI locatorを更新できません。", { blockId: block.id, fieldKey: field.key, count: resolved.matches });
      if (field.sourceType === "JS_LITERAL") field.locator = { stringOrdinal: resolved.candidate.ordinal, beforeAnchorSha256: resolved.candidate.beforeAnchorSha256, afterAnchorSha256: resolved.candidate.afterAnchorSha256 };
      field.sourceValueSha256 = sha256(resolved.value);
    }
    block.sourceValueSha256 = blockHash(block.fields);
  }
  const guideChangesById = new Map(validation.guideChanges.map((change) => [change.section.id, change]));
  for (const section of manifest.guideSections) {
    if (!outputs.has(section.sourcePath)) continue;
    const source = outputs.get(section.sourcePath);
    const element = findElement(source, { copySection: section.id });
    if (element.matches !== 1) throw new SiteCopyError("SITE_COPY_GUIDE_APPLY_FAILED", "反映後のguide sectionを一意に解決できません。", { sectionId: section.id, count: element.matches ?? 0 });
    const markdown = htmlToGuideMarkdown(source.slice(element.innerStart, element.innerEnd));
    const expected = guideChangesById.get(section.id)?.after;
    if (expected !== undefined && markdown !== expected) throw new SiteCopyError("SITE_COPY_GUIDE_APPLY_FAILED", "反映後のguide sectionが編集内容と一致しません。", { sectionId: section.id });
    section.sourceValueSha256 = sha256(markdown);
  }
  const changelogChangesById = new Map(validation.changelogChanges.map((change) => [change.entry.id, change]));
  for (const entry of manifest.changelogEntries) {
    if (!outputs.has(entry.sourcePath)) continue;
    const source = outputs.get(entry.sourcePath);
    const element = findElement(source, { copyEntry: entry.id });
    if (element.matches !== 1) throw new SiteCopyError("SITE_COPY_GUIDE_APPLY_FAILED", "反映後の更新履歴entryを一意に解決できません。", { entryId: entry.id, count: element.matches ?? 0 });
    const markdown = htmlToChangelogMarkdown(source.slice(element.innerStart, element.innerEnd), entry);
    const expected = changelogChangesById.get(entry.id)?.after;
    if (expected !== undefined && markdown !== expected) throw new SiteCopyError("SITE_COPY_GUIDE_APPLY_FAILED", "反映後の更新履歴entryが編集内容と一致しません。", { entryId: entry.id });
    entry.sourceValueSha256 = sha256(markdown);
  }
  const manifestRelative = path.relative(rootDir, path.resolve(manifestPath)).replace(/\\/gu, "/");
  if (manifestRelative.startsWith("..") || path.isAbsolute(manifestRelative)) throw new SiteCopyError("SITE_COPY_GUIDE_APPLY_FAILED", "manifestはrepository内である必要があります。", {});
  outputs.set(manifestRelative, canonicalJson(manifest));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "bms-site-copy-backup-"));
  const originals = new Map();
  const written = [];
  try {
    for (const sourcePath of outputs.keys()) {
      const absolute = path.join(rootDir, sourcePath);
      const original = sourcePath === manifestRelative ? fs.readFileSync(absolute, "utf8") : sourceCache.get(sourcePath);
      originals.set(sourcePath, original);
      const backupPath = path.join(backupDir, sourcePath);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.writeFileSync(backupPath, original, "utf8");
    }
    let writeCount = 0;
    for (const [sourcePath, output] of outputs) {
      if (options.failAfterWrites != null && writeCount >= options.failAfterWrites) throw new Error("injected write failure");
      fs.writeFileSync(path.join(rootDir, sourcePath), output, "utf8");
      written.push(sourcePath);
      writeCount += 1;
    }
  } catch (error) {
    for (const sourcePath of written) fs.writeFileSync(path.join(rootDir, sourcePath), originals.get(sourcePath), "utf8");
    throw new SiteCopyError("SITE_COPY_GUIDE_APPLY_FAILED", "反映に失敗したためbackupから復元しました。", { writtenCount: written.length, errorType: error?.constructor?.name ?? "Error" });
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
  return { code: "SITE_COPY_GUIDE_APPLY_COMPLETE", changedFiles: [...outputs.keys()], uiBlockCount: validation.uiChangeCount, guideSectionCount: validation.guideChangeCount, changelogEntryCount: validation.changelogChangeCount };
}

export function paragraphDiff(before, after) {
  const split = (value) => value.trim().split(/\n\s*\n/gu).map((item) => item.trim()).filter(Boolean);
  const beforeBlocks = split(before);
  const afterBlocks = split(after);
  return {
    removed: beforeBlocks.filter((item) => !afterBlocks.includes(item)),
    added: afterBlocks.filter((item) => !beforeBlocks.includes(item))
  };
}

export function exportSummary(manifest, result) {
  const guideCharacters = result.snapshot.guideSections.reduce((sum, section) => sum + [...section.currentMarkdown].length, 0);
  const linkCount = result.snapshot.guideSections.reduce((sum, section) => sum + linkIds(section.currentMarkdown).length, 0);
  const changelogCharacters = result.snapshot.changelogEntries.reduce((sum, entry) => sum + [...entry.currentMarkdown].length, 0);
  return { catalogId: manifest.catalogId, uiBlockCount: manifest.uiBlocks.length, guideSectionCount: manifest.guideSections.length, changelogEntryCount: manifest.changelogEntries.length, guideCharacters, changelogCharacters, linkCount, manualReviewCount: manifest.manualReview?.length ?? 0 };
}
