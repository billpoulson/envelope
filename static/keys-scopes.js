(function () {
  "use strict";

  var form = document.getElementById("key-create-form");
  if (!form) return;

  var hidden = document.getElementById("scopes_json_field");
  var adminRadio = document.getElementById("scope_access_admin");
  var customRadio = document.getElementById("scope_access_custom");
  var customPanel = document.getElementById("scope-custom-panel");
  var quickChecks = document.querySelectorAll("[data-scope-quick]");
  var kindSelect = document.getElementById("scope-kind");
  var patternInput = document.getElementById("scope-pattern");
  var addBtn = document.getElementById("scope-add-btn");
  var addPatternBtn = document.getElementById("scope-add-pattern-btn");
  var wrapBundle = document.getElementById("scope-wrap-bundle");
  var wrapStack = document.getElementById("scope-wrap-stack");
  var wrapProject = document.getElementById("scope-wrap-project");
  var targetBundle = document.getElementById("scope-target-bundle");
  var targetStack = document.getElementById("scope-target-stack");
  var targetProject = document.getElementById("scope-target-project");
  var chipsEl = document.getElementById("scope-chips");
  var advanced = document.getElementById("scopes-advanced");
  var advancedTa = document.getElementById("scopes_json_raw");
  var summaryEl = document.getElementById("scope-summary");

  /** @type {string[]} */
  var extraScopes = [];

  function isAdminMode() {
    return adminRadio && adminRadio.checked;
  }

  function getQuickScopes() {
    var out = [];
    quickChecks.forEach(function (cb) {
      if (cb.checked && cb.dataset.scopeQuick) {
        out.push(cb.dataset.scopeQuick);
      }
    });
    return out;
  }

  function uniq(list) {
    var seen = {};
    var r = [];
    list.forEach(function (x) {
      if (x && !seen[x]) {
        seen[x] = true;
        r.push(x);
      }
    });
    return r;
  }

  function buildScopeList() {
    if (isAdminMode()) {
      return ["admin"];
    }
    return uniq(getQuickScopes().concat(extraScopes));
  }

  function syncHidden() {
    if (!hidden) return;
    var list = buildScopeList();
    hidden.value = JSON.stringify(list);
    if (advancedTa && advanced && !advanced.open) {
      advancedTa.value = hidden.value;
    }
    renderSummary(list);
  }

  /** Merge Advanced JSON into the form and refresh hidden field. Returns false if JSON is invalid. */
  function prepareForSubmit() {
    if (advanced && advanced.open && advancedTa && advancedTa.value.trim()) {
      if (!loadFromJson(advancedTa.value.trim())) {
        return false;
      }
    } else {
      syncHidden();
    }
    return true;
  }

  function validateScopes() {
    if (!prepareForSubmit()) {
      return { ok: false, message: "Invalid JSON in Advanced — fix or close that section." };
    }
    var list;
    try {
      list = JSON.parse(hidden.value);
    } catch (err) {
      return { ok: false, message: "Invalid scopes data." };
    }
    if (!Array.isArray(list)) {
      return { ok: false, message: "Scopes must be a JSON array." };
    }
    if (list.length === 1 && list[0] === "admin") {
      return { ok: true };
    }
    if (list.length === 0) {
      return {
        ok: false,
        message: "Choose at least one access rule or Administrator.",
      };
    }
    return { ok: true };
  }

  function renderSummary(list) {
    if (!summaryEl) return;
    summaryEl.classList.remove("error");
    if (list.length === 1 && list[0] === "admin") {
      summaryEl.textContent =
        "Full access: manage API keys, bundles, projects, and secrets.";
      return;
    }
    if (list.length === 0) {
      summaryEl.textContent = "No scopes selected — choose at least one access rule.";
      summaryEl.classList.add("error");
      return;
    }
    var bits = [];
    list.forEach(function (s) {
      if (s === "read:bundle:*") bits.push("read any bundle");
      else if (s === "write:bundle:*") bits.push("change any bundle");
      else if (s === "read:project:*") bits.push("read bundles in any project");
      else if (s === "write:project:*") bits.push("manage all projects");
      else if (s === "read:stack:*") bits.push("read any stack");
      else if (s === "write:stack:*") bits.push("change any stack");
      else if (s === "terraform:http_state") bits.push("Terraform flat keys only (legacy)");
      else if (s === "pulumi:state") bits.push("Terraform flat keys (legacy)");
      else bits.push(s);
    });
    summaryEl.textContent = "This key can: " + bits.join("; ") + ".";
  }

  function renderChips() {
    if (!chipsEl) return;
    chipsEl.innerHTML = "";
    extraScopes.forEach(function (scope) {
      var li = document.createElement("li");
      li.className = "scope-chip";
      var code = document.createElement("code");
      code.textContent = scope;
      li.appendChild(code);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scope-chip-remove";
      btn.setAttribute("aria-label", "Remove " + scope);
      btn.textContent = "×";
      btn.addEventListener("click", function () {
        extraScopes = extraScopes.filter(function (x) {
          return x !== scope;
        });
        renderChips();
        syncHidden();
      });
      li.appendChild(btn);
      chipsEl.appendChild(li);
    });
  }

  function isBundleKind() {
    var k = kindSelect && kindSelect.value;
    return k === "read:bundle:" || k === "write:bundle:";
  }

  function isStackKind() {
    var k = kindSelect && kindSelect.value;
    return k === "read:stack:" || k === "write:stack:";
  }

  function isProjectKind() {
    var k = kindSelect && kindSelect.value;
    return k === "read:project:" || k === "write:project:";
  }

  function syncKindUI() {
    if (!wrapBundle || !wrapProject || !wrapStack) return;
    var b = isBundleKind();
    var s = isStackKind();
    var p = isProjectKind();
    wrapBundle.hidden = !b;
    wrapStack.hidden = !s;
    wrapProject.hidden = !p;
  }

  function addFromDropdown() {
    if (!kindSelect) return;
    var kind = kindSelect.value;
    var full;
    if (isBundleKind()) {
      if (!targetBundle) return;
      var bn = (targetBundle.value || "").trim();
      if (!bn) {
        targetBundle.focus();
        return;
      }
      full = kind + bn;
      targetBundle.value = "";
    } else if (isStackKind()) {
      if (!targetStack) return;
      var sn = (targetStack.value || "").trim();
      if (!sn) {
        targetStack.focus();
        return;
      }
      full = kind + sn;
      targetStack.value = "";
    } else {
      if (!targetProject) return;
      var slug = (targetProject.value || "").trim();
      if (!slug) {
        targetProject.focus();
        return;
      }
      full = kind + "slug:" + slug;
      targetProject.value = "";
    }
    if (extraScopes.indexOf(full) === -1) {
      extraScopes.push(full);
    }
    renderChips();
    syncHidden();
  }

  function addPatternScope() {
    if (!kindSelect || !patternInput) return;
    var kind = kindSelect.value;
    var pat = (patternInput.value || "").trim();
    if (!pat) {
      patternInput.focus();
      return;
    }
    var full = kind + pat;
    if (extraScopes.indexOf(full) === -1) {
      extraScopes.push(full);
    }
    patternInput.value = "";
    renderChips();
    syncHidden();
  }

  function loadFromJson(str) {
    try {
      var data = JSON.parse(str);
      if (!Array.isArray(data)) return false;

      extraScopes = [];
      quickChecks.forEach(function (cb) {
        cb.checked = false;
      });

      if (data.indexOf("admin") >= 0) {
        if (adminRadio) adminRadio.checked = true;
        if (customRadio) customRadio.checked = false;
        renderChips();
        togglePanel();
        syncKindUI();
        syncHidden();
        return true;
      }

      if (adminRadio) adminRadio.checked = false;
      if (customRadio) customRadio.checked = true;

      var quickMap = {};
      quickChecks.forEach(function (cb) {
        quickMap[cb.dataset.scopeQuick] = cb;
      });

      data.forEach(function (x) {
        var s = String(x).trim();
        if (!s) return;
        var cb = quickMap[s];
        if (cb) {
          cb.checked = true;
        } else if (extraScopes.indexOf(s) === -1) {
          extraScopes.push(s);
        }
      });

      renderChips();
      togglePanel();
      syncKindUI();
      syncHidden();
      return true;
    } catch (e) {
      return false;
    }
  }

  function togglePanel() {
    if (!customPanel) return;
    var show = customRadio && customRadio.checked;
    customPanel.hidden = !show;
    customPanel.setAttribute("aria-hidden", show ? "false" : "true");
  }

  if (adminRadio) {
    adminRadio.addEventListener("change", function () {
      if (isAdminMode()) {
        quickChecks.forEach(function (cb) {
          cb.checked = false;
        });
        extraScopes = [];
        renderChips();
      }
      togglePanel();
      syncHidden();
    });
  }

  if (customRadio) {
    customRadio.addEventListener("change", function () {
      if (
        customRadio.checked &&
        getQuickScopes().length === 0 &&
        extraScopes.length === 0
      ) {
        var rb = document.querySelector('[data-scope-quick="read:bundle:*"]');
        if (rb) rb.checked = true;
      }
      togglePanel();
      syncHidden();
    });
  }

  quickChecks.forEach(function (cb) {
    cb.addEventListener("change", syncHidden);
  });

  if (kindSelect) {
    kindSelect.addEventListener("change", syncKindUI);
  }

  if (addBtn) {
    addBtn.addEventListener("click", addFromDropdown);
  }
  if (addPatternBtn) {
    addPatternBtn.addEventListener("click", addPatternScope);
  }
  if (patternInput) {
    patternInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        addPatternScope();
      }
    });
  }

  if (advancedTa && advanced) {
    advanced.addEventListener("toggle", function () {
      if (advanced.open) {
        advancedTa.value = hidden.value;
      } else {
        loadFromJson(advancedTa.value);
      }
    });
  }

  form.addEventListener("submit", function (e) {
    var v = validateScopes();
    if (!v.ok) {
      e.preventDefault();
      if (v.message) {
        window.alert(v.message);
      }
    }
  });

  window.envelopeKeysScopes = {
    sync: syncHidden,
    validate: validateScopes,
  };

  (function init() {
    var initial = (hidden && hidden.value) ? hidden.value : '["read:bundle:*"]';
    loadFromJson(initial);
    syncKindUI();
    if (customRadio && customRadio.checked && getQuickScopes().length === 0 && extraScopes.length === 0) {
      var rb = document.querySelector('[data-scope-quick="read:bundle:*"]');
      if (rb) rb.checked = true;
      syncHidden();
    }
  })();
})();
