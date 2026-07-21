"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "docs", "index.html"), "utf8");
const moduleSource = fs.readFileSync(path.join(projectRoot, "docs", "chart-metadata-extract.js"), "utf8");
const postFormCss = fs.readFileSync(path.join(projectRoot, "docs", "post-form-ui.css"), "utf8");
const wranglerConfig = fs.readFileSync(path.join(projectRoot, "worker", "wrangler.toml"), "utf8");

const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepEqual(duplicateIds, [], "index.html must not contain duplicate IDs");

const idSet = new Set(ids);
for (const match of html.matchAll(/\baria-describedby="([^"]+)"/g)) {
  for (const id of match[1].split(/\s+/).filter(Boolean)) {
    assert.ok(idSet.has(id), `aria-describedby target is missing: ${id}`);
  }
}

for (const field of ["title", "subtitle", "artist", "subartist"]) {
  assert.equal((html.match(new RegExp(`data-metadata-field="${field}"`, "g")) || []).length, 1, `${field} metadata field`);
  assert.ok(html.includes(`for="${field}"`), `${field} label must use for`);
  assert.ok(html.includes(`id="metadataCandidateStatus-${field}"`), `${field} status must exist`);
}

const phase9cScriptIndex = html.indexOf("./post-form-error-ui.js");
const metadataScriptIndex = html.indexOf("./chart-metadata-extract.js");
const appScriptIndex = html.indexOf("./app.js");
assert.ok(phase9cScriptIndex >= 0, "Phase 9C script must exist");
assert.ok(metadataScriptIndex > phase9cScriptIndex, "metadata script must load after Phase 9C UI");
assert.ok(appScriptIndex > metadataScriptIndex, "metadata script must load before app.js");

assert.match(moduleSource, /button\.type = "button";/);
assert.match(moduleSource, /candidateText\.textContent = candidate\.raw;/);
assert.match(moduleSource, /closing === "）"/);
assert.doesNotMatch(moduleSource, /\.innerHTML\s*=/);
assert.equal((postFormCss.match(/{/g) || []).length, (postFormCss.match(/}/g) || []).length, "post form CSS braces");
assert.match(postFormCss, /button\.metadata-candidate-button\.metadata-candidate-close/);
assert.match(postFormCss, /min-height: 40px;/);
assert.match(postFormCss, /min-width: 40px;/);
assert.match(postFormCss, /metadata-candidate-close:focus-visible/);
assert.match(postFormCss, /metadata-candidate-close:active/);
assert.match(postFormCss, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(wranglerConfig, /WITHDRAWAL_CRON_MODE\s*=\s*"observe"/);
assert.match(wranglerConfig, /crons\s*=\s*\["0 18 \* \* \*", "0 \* \* \* \*"\]/);

console.log("chart metadata extract static checks: ok");
