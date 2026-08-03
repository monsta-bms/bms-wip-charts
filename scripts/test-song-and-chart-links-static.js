const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const app = read("docs/app.js");
const versionUiModel = read("docs/version-ui-model.js");
const versionLinkUi = read("docs/version-link-ui.js");
const versionActionUi = read("docs/version-action-ui.js");
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

assert.match(versionLinkUi, /originClass: "version-origin-link"/);
assert.match(versionLinkUi, /setAttribute\("target", "_blank"\)/);
assert.match(versionLinkUi, /setAttribute\("rel", "noopener noreferrer"\)/);
assert.match(versionLinkUi, /downloadClass: "version-download-control"/);
assert.match(branchAppend, /\$\{originControl\}[\s\S]*\$\{downloadControl\}[\s\S]*\$\{buildAppendControl\(entry, version, uiModel\)\}/);
assert.match(branchAppend, /BmsVersionLinkUi/);
assert.match(branchAppend, /BmsVersionActionUi/);
assert.doesNotMatch(app, /\$\{originControl\}|\$\{downloadControl\}|\$\{appendControl\}/);
assert.doesNotMatch(progressThumbnail, /\$\{originControl\}|\$\{downloadControl\}|\$\{appendControl\}/);
assert.match(versionActionUi, /button\.textContent = "追記投稿"/);
assert.match(versionUiModel, /function normalizeExternalHttpUrl\(value\)/);
assert.match(versionUiModel, /\["http:", "https:"\]\.includes\(url\.protocol\)/);
assert.match(versionUiModel, /url\.username \|\| url\.password/);
assert.match(app, /\["localhost", "127\.0\.0\.1"\][\s\S]*"http:\/\/localhost:8788"/);

assert.match(branchAppend, /\$\{originControl\}[\s\S]*\$\{downloadControl\}/);

assert.match(branchTree, /actions\.querySelector\("\.version-download-control"\)/);
assert.doesNotMatch(branchTree, /actions\.querySelector\("a\[href\], \.download-disabled"\)/);
assert.match(versionLinkUi, /version-download-control download-disabled download-button download-blocked-control/);
assert.match(branchTree, /enhanceLinkControls\(actions, uiModel, displayVersionLabel\)/);

assert.match(listHtml, /<span>リンク<\/span>/);
assert.match(listJs, /BmsVersionUiModel\?\.buildVersionUiModel/);
assert.match(versionUiModel, /new URL\(value\.trim\(\), workerBase\)/);
assert.match(versionUiModel, /url\.origin !== workerBase\.origin/);
assert.match(versionUiModel, /url\.pathname\.startsWith\(filePathPrefix\)/);
assert.match(listJs, /compact-song-title compact-detail-link/);
assert.match(listJs, /BmsVersionLinkUi/);
assert.match(versionLinkUi, /compact-link-control compact-origin-link/);
assert.match(versionLinkUi, /compact-link-control compact-download-disabled/);
assert.match(listCss, /150px;/);
assert.match(listCss, /"links links"/);
assert.match(themeCss, /\.download-blocked-control\s*\{[\s\S]*var\(--disabled-bg\)[\s\S]*var\(--disabled-text\)/);

assert.match(versionListRoute, /versions\.origin_url AS origin_url/);
assert.match(versionListRoute, /versions\.file_id AS file_id/);
assert.match(versionListRoute, /encodeURIComponent\(row\.file_id\)/);
assert.match(versionListRoute, /withdrawal_download_blocked === 1/);
assert.doesNotMatch(versionListRoute, /r2_key/i, "version list route must not select or expose R2 keys");

console.log("song and chart link static checks: ok");
