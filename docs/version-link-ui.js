(function initializeVersionLinkUi(factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module?.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.BmsVersionLinkUi = api;
  }
})(function createVersionLinkUiApi() {
  "use strict";

  const createdControls = new WeakSet();
  const variants = Object.freeze({
    default: Object.freeze({
      originClass: "version-origin-link",
      downloadClass: "version-download-control",
      downloadUnavailableClass: "version-download-control download-disabled",
      downloadUnavailableTitle: null
    }),
    tree: Object.freeze({
      originClass: "version-origin-link",
      downloadClass: "version-download-control download-button download-available-control",
      downloadUnavailableClass: "version-download-control download-disabled download-button download-blocked-control",
      downloadUnavailableTitle: "この版はダウンロードできません"
    }),
    compact: Object.freeze({
      originClass: "compact-link-control compact-origin-link",
      downloadClass: "compact-link-control compact-download-link",
      downloadUnavailableClass: "compact-link-control compact-download-disabled",
      downloadUnavailableTitle: null
    })
  });

  function getOptions(options) {
    return options && typeof options === "object" ? options : {};
  }

  function getVariant(options) {
    if (options.variant === "tree") return variants.tree;
    if (options.variant === "compact") return variants.compact;
    return variants.default;
  }

  function getDocument(options) {
    if (options.document && typeof options.document.createElement === "function") {
      return options.document;
    }
    if (typeof document !== "undefined" && typeof document.createElement === "function") {
      return document;
    }
    return null;
  }

  function setOptionalAttribute(element, name, value) {
    if (typeof value === "string" && value) {
      element.setAttribute(name, value);
    }
  }

  function markCreated(element) {
    createdControls.add(element);
    return element;
  }

  function createOriginLink(model, rawOptions = {}) {
    const options = getOptions(rawOptions);
    const targetDocument = getDocument(options);
    const originLink = model?.originLink;
    if (!targetDocument
      || originLink?.available !== true
      || typeof originLink.url !== "string"
      || !originLink.url) {
      return null;
    }

    const variant = getVariant(options);
    const anchor = targetDocument.createElement("a");
    anchor.className = variant.originClass;
    anchor.setAttribute("href", originLink.url);
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
    anchor.setAttribute("title", "原曲・本体の配布ページを開く");
    setOptionalAttribute(anchor, "aria-label", options.ariaLabel);
    anchor.textContent = typeof options.text === "string" ? options.text : "曲";
    return markCreated(anchor);
  }

  function createDownloadControl(model, rawOptions = {}) {
    const options = getOptions(rawOptions);
    const targetDocument = getDocument(options);
    if (!targetDocument) {
      return null;
    }

    const variant = getVariant(options);
    const download = model?.download;
    const available = download?.available === true
      && typeof download.url === "string"
      && Boolean(download.url);
    const control = targetDocument.createElement(available ? "a" : "span");
    control.className = available ? variant.downloadClass : variant.downloadUnavailableClass;
    if (available) {
      control.setAttribute("href", download.url);
      setOptionalAttribute(control, "aria-label", options.availableAriaLabel ?? options.ariaLabel);
      control.textContent = "DL";
    } else {
      setOptionalAttribute(control, "title", variant.downloadUnavailableTitle);
      setOptionalAttribute(control, "aria-label", options.unavailableAriaLabel ?? options.ariaLabel);
      control.textContent = "DL不可";
    }
    return markCreated(control);
  }

  function serializeControl(element) {
    if (!element || !createdControls.has(element) || typeof element.outerHTML !== "string") {
      return "";
    }
    return element.outerHTML;
  }

  return Object.freeze({
    createOriginLink,
    createDownloadControl,
    serializeControl
  });
});
