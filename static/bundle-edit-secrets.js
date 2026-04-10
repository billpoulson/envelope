(function () {
  "use strict";

  var root = document.getElementById("bundle-edit-root");
  if (!root) return;

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
