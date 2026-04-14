(function () {
  "use strict";

  var root = document.getElementById("bundle-edit-root");
  if (!root) return;

  (function scrollHighlightRowIntoView() {
    var row = document.querySelector("table.bundle-vars-table tbody tr.highlight-row");
    if (!row) return;

    function scroll() {
      row.scrollIntoView({ block: "center", behavior: "auto" });
    }

    /* Re-run after full layout: first scrollIntoView can run before fonts/images settle. */
    window.addEventListener("load", scroll, { once: true });
    setTimeout(scroll, 0);
    setTimeout(scroll, 350);
  })();

  (function initAddEntryModal() {
    var dlg = document.getElementById("bundle-add-entry-modal");
    var openBtn = document.getElementById("bundle-add-entry-open");
    if (!dlg || typeof dlg.showModal !== "function") return;

    var cancelBtn = document.getElementById("bundle-add-entry-cancel");

    dlg.addEventListener("close", function () {
      var form = dlg.querySelector("form");
      if (form) form.reset();
    });

    if (openBtn) {
      openBtn.addEventListener("click", function () {
        dlg.showModal();
        var keyInput = document.getElementById("key_name_new");
        if (keyInput) keyInput.focus();
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        if (dlg.open) dlg.close();
      });
    }
  })();

  (function initEditEntryModal() {
    var dlg = document.getElementById("bundle-edit-entry-modal");
    if (!dlg || typeof dlg.showModal !== "function") return;

    dlg.showModal();
    var keyInput = document.getElementById("key_name_edit");
    if (keyInput) keyInput.focus();
  })();

  (function initBundleRowDblClickEdit() {
    var base = root.getAttribute("data-bundle-route-base");
    if (!base) return;
    document.querySelectorAll("table.bundle-vars-table tbody tr.bundle-var-row:not(.bundle-var-row--empty)").forEach(function (row) {
      row.addEventListener("dblclick", function (e) {
        if (e.target.closest("a, button, input, textarea, select, summary, label")) return;
        if (e.target.closest(".bundle-var-actions")) return;
        var cell = row.querySelector(".bundle-value-cell[data-key]");
        var k = cell && cell.getAttribute("data-key");
        if (!k) return;
        window.location.href = base + "/edit?key=" + encodeURIComponent(k);
      });
    });
  })();

  (function initBundleVarActionMenus() {
    document.querySelectorAll(".bundle-var-actions-menu").forEach(function (d) {
      d.addEventListener("toggle", function () {
        if (!d.open) return;
        document.querySelectorAll(".bundle-var-actions-menu[open]").forEach(function (o) {
          if (o !== d) o.open = false;
        });
      });
    });
  })();

  var url = root.dataset.secretValuesUrl;
  var cb = document.getElementById("bundle-show-secrets");
  var hint = document.getElementById("bundle-secret-hint");
  if (!cb || !url) return;

  var cached = null;

  function applySecrets(map) {
    document.querySelectorAll(".bundle-value-secret").forEach(function (cell) {
      var k = cell.getAttribute("data-key");
      if (!k || !Object.prototype.hasOwnProperty.call(map, k)) return;
      var rev = cell.querySelector(".secret-revealed");
      var mask = cell.querySelector(".secret-masked");
      if (rev && mask) {
        rev.textContent = map[k];
        rev.hidden = false;
        mask.hidden = true;
      }
    });
  }

  function clearSecrets() {
    document.querySelectorAll(".bundle-value-secret .secret-revealed").forEach(function (el) {
      el.hidden = true;
      el.textContent = "";
    });
    document.querySelectorAll(".bundle-value-secret .secret-masked").forEach(function (el) {
      el.hidden = false;
    });
  }

  cb.addEventListener("change", function () {
    if (cb.checked) {
      if (cached) {
        applySecrets(cached);
        if (hint) hint.hidden = false;
        return;
      }
      fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
        .then(function (r) {
          if (!r.ok) throw new Error("request failed");
          var ct = r.headers.get("content-type") || "";
          if (ct.indexOf("application/json") === -1) throw new Error("not json");
          return r.json();
        })
        .then(function (data) {
          cached = data;
          applySecrets(data);
          if (hint) hint.hidden = false;
        })
        .catch(function () {
          cb.checked = false;
          cached = null;
        });
    } else {
      cached = null;
      clearSecrets();
      if (hint) hint.hidden = true;
    }
  });
})();
