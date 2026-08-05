(() => {
  "use strict";

  const header = document.querySelector("[data-site-header]");
  if (!header) {
    return;
  }

  const scriptUrl = new URL(document.currentScript?.src || "./site-header.js", document.baseURI);
  const pagesRoot = new URL("./", scriptUrl);
  const workerBaseUrl = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
  const pageUrl = (path) => new URL(path, pagesRoot).href;
  const menuId = "publicSiteNavigation";

  const links = [
    {
      key: "home",
      label: "\u30ea\u30b5\u30a4\u30af\u30eb\u30bb\u30f3\u30bf\u30fc",
      href: pageUrl("index.html#top"),
      brand: true
    },
    { key: "rc-star", label: "RC\u2605", href: `${workerBaseUrl}/difficulty-tables/rc-star` },
    { key: "rc-double-star", label: "RC\u2605\u2605", href: `${workerBaseUrl}/difficulty-tables/rc-double-star` },
    { key: "guide", label: "\u4f7f\u3044\u65b9", href: pageUrl("guide.html") },
    { key: "post", label: "\u6295\u7a3f\u3059\u308b", href: pageUrl("index.html#post") },
    { key: "list", label: "\u6295\u7a3f\u4e00\u89a7", href: pageUrl("list.html") },
    { key: "changelog", label: "\u66f4\u65b0\u5c65\u6b74", href: pageUrl("changelog.html") }
  ];

  const brandLink = document.createElement("a");
  brandLink.className = "site-brand";
  brandLink.href = links[0].href;
  brandLink.dataset.siteLink = "home";
  brandLink.textContent = links[0].label;

  const menuButton = document.createElement("button");
  menuButton.className = "site-menu-toggle";
  menuButton.type = "button";
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-controls", menuId);
  menuButton.setAttribute("aria-label", "\u30e1\u30cb\u30e5\u30fc\u3092\u958b\u304f");
  menuButton.innerHTML = '<span class="site-menu-icon" aria-hidden="true">\u2630</span><span>\u30e1\u30cb\u30e5\u30fc</span>';

  const navigation = document.createElement("nav");
  navigation.className = "site-navigation";
  navigation.id = menuId;
  navigation.setAttribute("aria-label", "\u5171\u901a\u30ca\u30d3\u30b2\u30fc\u30b7\u30e7\u30f3");

  const navigationList = document.createElement("div");
  navigationList.className = "site-navigation-list";
  links.slice(1).forEach((item) => {
    const link = document.createElement("a");
    link.href = item.href;
    link.dataset.siteLink = item.key;
    link.textContent = item.label;
    navigationList.append(link);
  });
  window.BmsTheme?.mountControl?.(navigationList);
  navigation.append(navigationList);
  header.replaceChildren(brandLink, menuButton, navigation);
  window.BmsTheme?.syncThemeLinks?.(header);

  function closeMenu({ restoreFocus = false } = {}) {
    header.classList.remove("is-menu-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "\u30e1\u30cb\u30e5\u30fc\u3092\u958b\u304f");
    if (restoreFocus) {
      menuButton.focus();
    }
  }

  function openMenu() {
    header.classList.add("is-menu-open");
    menuButton.setAttribute("aria-expanded", "true");
    menuButton.setAttribute("aria-label", "\u30e1\u30cb\u30e5\u30fc\u3092\u9589\u3058\u308b");
  }

  function updateCurrentLink() {
    const currentPage = header.dataset.currentPage || "";
    const hash = window.location.hash.toLowerCase();
    const currentKey = currentPage === "home" && (hash === "#post" || hash === "#list")
      ? hash.slice(1)
      : currentPage;

    header.querySelectorAll("[data-site-link]").forEach((link) => {
      link.removeAttribute("aria-current");
      if (link.dataset.siteLink === currentKey) {
        const isLocation = currentKey === "post" || currentKey === "list";
        link.setAttribute("aria-current", isLocation ? "location" : "page");
      }
    });
  }

  menuButton.addEventListener("click", () => {
    if (header.classList.contains("is-menu-open")) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  navigation.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) {
      return;
    }

    const targetUrl = new URL(link.href, window.location.href);
    if (targetUrl.pathname === window.location.pathname && targetUrl.hash === "#post") {
      window.dispatchEvent(new CustomEvent("bms:open-post-form"));
    }
    closeMenu();
  });

  document.addEventListener("click", (event) => {
    if (header.classList.contains("is-menu-open") && !header.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && header.classList.contains("is-menu-open")) {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    }
  });

  window.addEventListener("hashchange", updateCurrentLink);
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1024) {
      closeMenu();
    }
  });

  updateCurrentLink();
})();
