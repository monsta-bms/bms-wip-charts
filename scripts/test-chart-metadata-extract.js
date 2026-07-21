"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const metadataExtract = require("../docs/chart-metadata-extract.js");

function raws(value, sourceKey) {
  return metadataExtract.parseCandidates(value, sourceKey).map((candidate) => candidate.raw);
}

function authors(value) {
  return metadataExtract.parseCandidates(value, "artist")
    .filter((candidate) => candidate.kind === "author")
    .map((candidate) => [candidate.raw, candidate.transferValue]);
}

function assertSingleAuthor(value, raw, name) {
  assert.deepEqual(authors(value), [[raw, name]], value);
}

assert.deepEqual(raws("Faraway Sky (All I C Is U) [Nebula]", "title"), ["(All I C Is U)", "[Nebula]"]);
assert.deepEqual(raws("3.14 (TT mix) [yumether]", "title"), ["(TT mix)", "[yumether]"]);
assert.deepEqual(raws("3.14 (TT mix) (yumether)", "title"), ["(TT mix)", "(yumether)"]);
assert.deepEqual(raws("3.14 (TT mix)", "title"), ["(TT mix)"]);
assert.deepEqual(raws("[ANOTHER] (改造版)", "title"), ["[ANOTHER]", "(改造版)"]);
assert.deepEqual(raws("Song -ANOTHER-", "title"), ["-ANOTHER-"]);
assert.deepEqual(raws("Song --INSANE--", "title"), ["--INSANE--"]);
assert.deepEqual(raws("Song ー黒ー", "title"), ["ー黒ー"]);
assert.deepEqual(raws("Song (mix) extra", "title"), []);
assert.deepEqual(raws("Song ()", "title"), []);
assert.deepEqual(raws("Song -ANOTHER--", "title"), []);
assert.deepEqual(raws("Song --ANOTHER-", "title"), []);
assert.deepEqual(raws("Song ---ANOTHER---", "title"), []);
assert.deepEqual(raws("Song [ANOTHER]", "artist"), []);

for (const [value, raw] of [
  ["obj: monsta", "obj: monsta"],
  ["OBJ：monsta", "OBJ：monsta"],
  ["obj.monsta", "obj.monsta"],
  ["OBJ．monsta", "OBJ．monsta"],
  ["obj;monsta", "obj;monsta"],
  ["OBJ；monsta", "OBJ；monsta"],
  ["obj@monsta", "obj@monsta"],
  ["OBJ@monsta", "OBJ@monsta"],
  ["obj monsta", "obj monsta"],
  ["OBJ　monsta", "OBJ　monsta"],
  ["obj　：　monsta", "obj　：　monsta"],
  ["obj\t;\tmonsta", "obj\t;\tmonsta"]
]) {
  assertSingleAuthor(value, raw, "monsta");
}

for (const value of ["obj:", "obj@", "object:monsta", "objective monsta"]) {
  assert.deepEqual(authors(value), [], value);
}

for (const [value, raw] of [
  ["Note:monsta", "Note:monsta"],
  ["NOTE：monsta", "NOTE：monsta"],
  ["notes;monsta", "notes;monsta"],
  ["NOTES；monsta", "NOTES；monsta"]
]) {
  assertSingleAuthor(value, raw, "monsta");
}

for (const value of ["note:", "notes:", "notebook:monsta"]) {
  assert.deepEqual(authors(value), [], value);
}

for (const [value, raw] of [
  ["chart:monsta", "chart:monsta"],
  ["Chart：monsta", "Chart：monsta"],
  ["charter;monsta", "charter;monsta"],
  ["Charter；monsta", "Charter；monsta"]
]) {
  assertSingleAuthor(value, raw, "monsta");
}

for (const value of ["chart:", "charter:", "chartreuse:monsta"]) {
  assert.deepEqual(authors(value), [], value);
}

assert.deepEqual(authors("原曲作者 obj:monsta obj:俺"), [["obj:monsta", "monsta"], ["obj:俺", "俺"]]);
assert.deepEqual(authors("原曲作者 / obj:monsta / obj:俺"), [["obj:monsta", "monsta"], ["obj:俺", "俺"]]);
assert.deepEqual(authors("obj:monsta obj@俺"), [["obj:monsta", "monsta"], ["obj@俺", "俺"]]);
assert.deepEqual(authors("Notes:monsta Charter:俺"), [["Notes:monsta", "monsta"], ["Charter:俺", "俺"]]);
assert.deepEqual(raws("曲名 [ANOTHER] obj:monsta", "title"), ["[ANOTHER]", "obj:monsta"]);
assert.deepEqual(raws("曲名 obj:monsta [ANOTHER]", "title"), ["obj:monsta", "[ANOTHER]"]);
assert.deepEqual(raws("曲名 (改造版) Notes:monsta", "title"), ["(改造版)", "Notes:monsta"]);

for (const value of [
  "not Project Nirvana / obj:potechang",
  "not Project Nirvana/obj:potechang",
  "BACO / Sobrem / obj:potechang",
  "BACO/Sobrem/obj:potechang",
  "not Project Nirvana / obj@potechang",
  "not Project Nirvana / obj potechang"
]) {
  const candidate = metadataExtract.parseCandidates(value, "artist").find((item) => item.kind === "author");
  assert.ok(candidate?.relatedSeparator, value);
  assert.equal(candidate.transferValue, "potechang", value);
}

assert.deepEqual(authors("not Project Nirvana / obj:monsta / obj:俺"), [["obj:monsta", "monsta"], ["obj:俺", "俺"]]);
assert.deepEqual(authors("not Project Nirvana / potechang"), []);
assert.deepEqual(authors("not Project Nirvana / obj:"), []);
assert.deepEqual(raws("BACO / Sobrem", "artist"), []);
assert.deepEqual(authors("obj:potechang"), [["obj:potechang", "potechang"]]);
assert.equal(metadataExtract.parseCandidates("obj:potechang", "subartist")[0].relatedSeparator, null);

const spacedSource = "BACO / Sobrem / obj:potechang";
const spacedAuthor = metadataExtract.parseCandidates(spacedSource, "artist").find((candidate) => candidate.kind === "author");
const spacedRemoval = metadataExtract.removeCandidateRange(spacedSource, spacedAuthor.start, spacedAuthor.end);
assert.equal(spacedRemoval.value, "BACO / Sobrem /");
const spacedSlash = spacedRemoval.mapIndex(spacedAuthor.relatedSeparator.slashIndex);
assert.equal(metadataExtract.removeSeparatorRange(spacedRemoval.value, spacedSlash, spacedAuthor.relatedSeparator).value, "BACO / Sobrem");

const compactSource = "BACO/Sobrem/obj:potechang";
const compactAuthor = metadataExtract.parseCandidates(compactSource, "artist").find((candidate) => candidate.kind === "author");
const compactRemoval = metadataExtract.removeCandidateRange(compactSource, compactAuthor.start, compactAuthor.end);
assert.equal(compactRemoval.value, "BACO/Sobrem/");
const compactSlash = compactRemoval.mapIndex(compactAuthor.relatedSeparator.slashIndex);
assert.equal(metadataExtract.removeSeparatorRange(compactRemoval.value, compactSlash, compactAuthor.relatedSeparator).value, "BACO/Sobrem");

const xssCandidate = metadataExtract.parseCandidates("Song [<img src=x onerror=alert(1)>]", "title")[0];
assert.equal(xssCandidate.raw, "[<img src=x onerror=alert(1)>]");
assert.deepEqual(metadataExtract.parseCandidates(`Song [${"x".repeat(metadataExtract.limits.maxSourceLength)}]`, "title"), []);

const fixtureText = fs.readFileSync(path.join(__dirname, "fixtures", "chart-metadata-extract-utf8.bms"), "utf8");
const fixtureMeta = Object.fromEntries(fixtureText
  .split(/\r?\n/)
  .map((line) => line.match(/^#(TITLE|SUBTITLE|ARTIST|SUBARTIST)\s+(.+)$/i))
  .filter(Boolean)
  .map((match) => [match[1].toLowerCase(), match[2].trim()]));
assert.deepEqual(raws(fixtureMeta.title, "title"), ["(All I C Is U)", "[Nebula]"]);
assert.deepEqual(raws(fixtureMeta.subtitle, "subtitle"), ["(TT mix)", "[yumether]"]);
assert.deepEqual(authors(fixtureMeta.artist), [["obj:potechang", "potechang"]]);
assert.deepEqual(authors(fixtureMeta.subartist), [["Notes:fixture mapper", "fixture mapper"]]);

console.log("chart metadata extract parser fixtures: ok");
