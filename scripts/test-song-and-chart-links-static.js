const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const app = read("docs/app.js");
const branchTree = read("docs/branch-tree-list.js");
const branchAppend = read("docs/branch-append-ui.js");
const progressThumbnail = read("docs/progress-thumbnail-list.js");
const listHtml = read("docs/list.html");
const listJs = read("docs/list.js");
const listCss = read("docs/list.css");
const indexHtml = read("docs/index.html");
const themeCss = read("docs/theme.css");
const versionListRoute = read("worker/src/routes/versionList.ts");

function duplicateIds(source) {
  const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}

assert.deepEqual(duplicateIds(indexHtml), [], "index.html must not contain duplicate IDs");
assert.deepEqual(duplicateIds(listHtml), [], "list.html must not contain duplicate IDs");

assert.match(app, /class="version-origin-link"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
assert.match(app, /class="version-download-control"/);
assert.match(app, /\$\{originControl\}[\s\S]*\$\{downloadControl\}[\s\S]*追記投稿/);
assert.match(app, /url\.protocol === "http:" \|\| url\.protocol === "https:"/);
assert.match(app, /\["localhost", "127\.0\.0\.1"\][\s\S]*"http:\/\/localhost:8788"/);

for (const renderer of [branchAppend, progressThumbnail]) {
  assert.match(renderer, /class="version-origin-link"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(renderer, /class="version-download-control"/);
  assert.match(renderer, /\$\{originControl\}[\s\S]*\$\{downloadControl\}/);
}

assert.match(branchTree, /actions\.querySelector\("\.version-download-control"\)/);
assert.doesNotMatch(branchTree, /actions\.querySelector\("a\[href\], \.download-disabled"\)/);
assert.match(branchTree, /version-download-control download-disabled download-button download-blocked-control/);
assert.match(branchTree, /enhanceOriginControl\(row, displayVersionLabel\);\s*enhanceDownloadControl/);

assert.match(listHtml, /<span>リンク<\/span>/);
assert.match(listJs, /new URL\(String\(value \|\| ""\), apiBase\)/);
assert.match(listJs, /url\.origin === apiBase\.origin/);
assert.match(listJs, /url\.pathname\.startsWith\("\/api\/files\/"\)/);
assert.match(listJs, /compact-song-title compact-detail-link/);
assert.match(listJs, /compact-origin-link[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
assert.match(listJs, /compact-download-disabled/);
assert.match(listCss, /92px;/);
assert.match(listCss, /"links links"/);
assert.match(themeCss, /\.download-blocked-control\s*\{[\s\S]*var\(--disabled-bg\)[\s\S]*var\(--disabled-text\)/);

assert.match(versionListRoute, /versions\.origin_url AS origin_url/);
assert.match(versionListRoute, /versions\.file_id AS file_id/);
assert.match(versionListRoute, /encodeURIComponent\(row\.file_id\)/);
assert.match(versionListRoute, /withdrawal_download_blocked === 1/);
assert.doesNotMatch(versionListRoute, /r2_key/i, "version list route must not select or expose R2 keys");

console.log("song and chart link static checks: ok");
