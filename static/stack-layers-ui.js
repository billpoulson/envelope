(function () {
  "use strict";

  var root = document.getElementById("stack-layers-root");
  if (!root) return;

  var mode = root.getAttribute("data-mode") || "edit";
  var projectsPrefix = root.getAttribute("data-projects-prefix") || "/projects/";
  var legacyPrefix = root.getAttribute("data-legacy-prefix") || "/bundles/";
  var projectSlugFixed = (root.getAttribute("data-project-slug") || "").trim();
  var bundlesByProject = {};
  try {
    bundlesByProject = JSON.parse(root.getAttribute("data-bundles-by-project") || "{}");
  } catch (e) {
    bundlesByProject = {};
  }
  var bundlesFlat = [];
  try {
    bundlesFlat = JSON.parse(root.getAttribute("data-bundles-json") || "[]");
  } catch (e2) {
    bundlesFlat = [];
  }

  var initialEl = document.getElementById("stack-layers-initial");
  var initialLayers = [{ bundle: "", keys: "*" }];
  if (initialEl && initialEl.textContent) {
    try {
      initialLayers = JSON.parse(initialEl.textContent.trim());
    } catch (e3) {
      initialLayers = [{ bundle: "", keys: "*" }];
    }
  }
  if (!Array.isArray(initialLayers) || initialLayers.length === 0) {
    initialLayers = [{ bundle: "", keys: "*" }];
  }

  var hiddenInput = document.getElementById("stack-layers-json-input");
  var projectSelect = document.getElementById("project_slug");

  function currentProjectSlug() {
    if (projectSlugFixed) return projectSlugFixed;
    if (!projectSelect) return "";
    return (projectSelect.value || "").trim();
  }

  function bundleNamesForProject() {
    var slug = currentProjectSlug();
    if (mode === "new" && slug && bundlesByProject[slug]) {
      return bundlesByProject[slug];
    }
    if (bundlesFlat.length) return bundlesFlat;
    if (slug && bundlesByProject[slug]) return bundlesByProject[slug];
    return [];
  }

  function keyNamesUrl(bundleName) {
    var slug = currentProjectSlug();
    var b = encodeURIComponent(bundleName);
    if (slug) {
      return projectsPrefix + encodeURIComponent(slug) + "/bundles/" + b + "/variable-key-names";
    }
    return legacyPrefix + b + "/variable-key-names";
  }

  /** bundle name -> Promise<string[]> | string[] (resolved cache) */
  var bundleKeyNamesCache = {};

  function fetchBundleKeyNames(bundleName) {
    var bn = (bundleName || "").trim();
    if (!bn) return Promise.resolve([]);
    var cached = bundleKeyNamesCache[bn];
    if (cached !== undefined) {
      if (cached && typeof cached.then === "function") return cached;
      return Promise.resolve(cached);
    }
    var p = fetch(keyNamesUrl(bn), { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error(r.statusText || String(r.status));
        return r.json();
      })
      .then(function (data) {
        var keys = (data.keys || []).slice();
        bundleKeyNamesCache[bn] = keys;
        return keys;
      })
      .catch(function (err) {
        delete bundleKeyNamesCache[bn];
        throw err;
      });
    bundleKeyNamesCache[bn] = p;
    return p;
  }

  /**
   * Key names contributed by layers below `index` (union; matches server merge semantics).
   * Caller must syncStateFromDom() first.
   */
  function forwardedKeyNamesBefore(index) {
    var promises = [];
    for (var j = 0; j < index; j++) {
      var L = state.layers[j];
      if (!L) continue;
      var b = (L.bundle || "").trim();
      if (!b) continue;
      if (L.mode === "all") {
        promises.push(fetchBundleKeyNames(b));
      } else {
        promises.push(Promise.resolve((L.selected || []).slice()));
      }
    }
    return Promise.all(promises).then(function (arrays) {
      var seen = {};
      var out = [];
      arrays.forEach(function (arr) {
        arr.forEach(function (k) {
          var s = (k || "").trim();
          if (!s || seen[s]) return;
          seen[s] = true;
          out.push(s);
        });
      });
      return out.sort(function (a, b) {
        return a.localeCompare(b);
      });
    });
  }

  var state = {
    layers: initialLayers.map(function (L) {
      var bundle = typeof L.bundle === "string" ? L.bundle : "";
      var keys = L.keys;
      var label = typeof L.label === "string" ? L.label : "";
      if (keys === "*") {
        return { bundle: bundle, mode: "all", selected: [], loadedKeys: [], label: label };
      }
      if (Array.isArray(keys)) {
        return {
          bundle: bundle,
          mode: "pick",
          selected: keys.slice(),
          loadedKeys: [],
          label: label,
        };
      }
      return { bundle: bundle, mode: "all", selected: [], loadedKeys: [], label: label };
    }),
  };

  var listEl = document.createElement("div");
  listEl.className = "stack-layers-list";
  root.appendChild(listEl);

  /** Per-layer loadKeys; filled each render. Used to refresh upper "Selected only" rows. */
  var refreshPickListForLayer = [];

  var refreshBelowTimer = null;
  var refreshBelowPendingMin = null;

  function scheduleRefreshPickListsBelow(fromIndex) {
    if (refreshBelowTimer) clearTimeout(refreshBelowTimer);
    refreshBelowPendingMin =
      refreshBelowPendingMin === null
        ? fromIndex
        : Math.min(refreshBelowPendingMin, fromIndex);
    refreshBelowTimer = setTimeout(function () {
      refreshBelowTimer = null;
      var start = refreshBelowPendingMin;
      refreshBelowPendingMin = null;
      if (start === null) return;
      syncStateFromDom();
      for (var k = start + 1; k < refreshPickListForLayer.length; k++) {
        var L = state.layers[k];
        if (
          L &&
          L.mode === "pick" &&
          (L.bundle || "").trim() &&
          refreshPickListForLayer[k]
        ) {
          refreshPickListForLayer[k]();
        }
      }
    }, 60);
  }

  function renderRow(layer, index) {
    var row = document.createElement("div");
    row.className = "stack-layer-row";

    var bundleId = "stack-layer-bundle-" + index;

    var header = document.createElement("div");
    header.className = "stack-layer-header";
    var headerMain = document.createElement("div");
    headerMain.className = "stack-layer-header-main";
    var badge = document.createElement("span");
    badge.className = "stack-layer-badge";
    var titleText = (layer.label || "").trim();
    badge.textContent = titleText || "Layer " + (index + 1);
    var sub = document.createElement("span");
    sub.className = "stack-layer-badge-note muted";
    if (index === 0) sub.textContent = "Bottom";
    else if (index === state.layers.length - 1) sub.textContent = "Top — wins on duplicate keys";
    else sub.textContent = "Middle";
    headerMain.appendChild(badge);
    headerMain.appendChild(sub);
    header.appendChild(headerMain);

    var headerActions = document.createElement("div");
    headerActions.className = "stack-layer-header-actions";
    if (index > 0) {
      var up = document.createElement("button");
      up.type = "button";
      up.className = "secondary-outline small stack-layer-icon-btn";
      up.setAttribute("aria-label", "Move layer up");
      up.title = "Move up";
      up.textContent = "↑";
      up.addEventListener("click", function () {
        syncStateFromDom();
        var t = state.layers[index - 1];
        state.layers[index - 1] = state.layers[index];
        state.layers[index] = t;
        render();
      });
      headerActions.appendChild(up);
    }
    if (index < state.layers.length - 1) {
      var down = document.createElement("button");
      down.type = "button";
      down.className = "secondary-outline small stack-layer-icon-btn";
      down.setAttribute("aria-label", "Move layer down");
      down.title = "Move down";
      down.textContent = "↓";
      down.addEventListener("click", function () {
        syncStateFromDom();
        var t = state.layers[index + 1];
        state.layers[index + 1] = state.layers[index];
        state.layers[index] = t;
        render();
      });
      headerActions.appendChild(down);
    }
    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-outline small";
    remove.textContent = "Remove";
    if (state.layers.length <= 1) {
      remove.disabled = true;
      remove.title = "A stack needs at least one layer";
    }
    remove.addEventListener("click", function () {
      if (state.layers.length <= 1) return;
      syncStateFromDom();
      state.layers.splice(index, 1);
      render();
    });
    headerActions.appendChild(remove);
    header.appendChild(headerActions);
    row.appendChild(header);

    var body = document.createElement("div");
    body.className = "stack-layer-body";

    var nameField = document.createElement("div");
    nameField.className = "stack-field stack-field-layer-name";
    var nameLabel = document.createElement("label");
    nameLabel.className = "stack-field-label";
    nameLabel.setAttribute("for", "stack-layer-label-" + index);
    nameLabel.textContent = "Layer name (optional)";
    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.id = "stack-layer-label-" + index;
    nameInput.className = "stack-layer-label-input";
    nameInput.value = layer.label || "";
    nameInput.placeholder = "Shown in the UI; underlying bundle is unchanged";
    nameInput.maxLength = 256;
    nameInput.setAttribute("aria-label", "Optional display name for layer " + (index + 1));
    nameInput.addEventListener("input", function () {
      layer.label = nameInput.value || "";
      var t = (layer.label || "").trim();
      badge.textContent = t || "Layer " + (index + 1);
    });
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    body.appendChild(nameField);

    var bundleField = document.createElement("div");
    bundleField.className = "stack-field stack-field-bundle";
    var bundleLabel = document.createElement("label");
    bundleLabel.className = "stack-field-label";
    bundleLabel.setAttribute("for", bundleId);
    bundleLabel.textContent = "Bundle";
    var bundleSel = document.createElement("select");
    bundleSel.id = bundleId;
    bundleSel.className = "mono stack-layer-bundle";
    bundleSel.setAttribute("aria-label", "Bundle for layer " + (index + 1));
    var opts = bundleNamesForProject();
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = opts.length ? "Select a bundle…" : "No bundles in this project";
    bundleSel.appendChild(ph);
    opts.forEach(function (nm) {
      var o = document.createElement("option");
      o.value = nm;
      o.textContent = nm;
      if (nm === layer.bundle) o.selected = true;
      bundleSel.appendChild(o);
    });
    bundleField.appendChild(bundleLabel);
    bundleField.appendChild(bundleSel);
    body.appendChild(bundleField);

    var varsField = document.createElement("div");
    varsField.className = "stack-field stack-field-vars";
    var varsLabel = document.createElement("div");
    varsLabel.className = "stack-field-label";
    varsLabel.textContent = "Variables";
    varsField.appendChild(varsLabel);

    var modeRow = document.createElement("div");
    modeRow.className = "stack-layer-mode-row";
    modeRow.setAttribute("role", "group");
    modeRow.setAttribute("aria-label", "Variable scope for layer " + (index + 1));

    var allLab = document.createElement("label");
    allLab.className = "stack-layer-pill";
    var allRb = document.createElement("input");
    allRb.type = "radio";
    allRb.name = "layer-keys-mode-" + index;
    allRb.value = "all";
    allRb.checked = layer.mode === "all";
    allLab.appendChild(allRb);
    var allSpan = document.createElement("span");
    allSpan.className = "stack-layer-pill-text";
    allSpan.textContent = "All keys";
    allLab.appendChild(allSpan);
    modeRow.appendChild(allLab);

    var pickLab = document.createElement("label");
    pickLab.className = "stack-layer-pill";
    var pickRb = document.createElement("input");
    pickRb.type = "radio";
    pickRb.name = "layer-keys-mode-" + index;
    pickRb.value = "pick";
    pickRb.checked = layer.mode === "pick";
    pickLab.appendChild(pickRb);
    var pickSpan = document.createElement("span");
    pickSpan.className = "stack-layer-pill-text";
    pickSpan.textContent = "Selected only";
    pickLab.appendChild(pickSpan);
    modeRow.appendChild(pickLab);
    varsField.appendChild(modeRow);

    var keysBox = document.createElement("div");
    keysBox.className = "stack-layer-key-panel";
    keysBox.hidden = layer.mode !== "pick";
    varsField.appendChild(keysBox);

    if (index > 0) {
      var forwardHint = document.createElement("p");
      forwardHint.className = "muted small stack-layer-key-forward-hint";
      forwardHint.textContent =
        "Includes names from this bundle and from lower layers. The list updates when you change bundles, scope, or selections below.";
      keysBox.appendChild(forwardHint);
    }

    var keysToolbar = document.createElement("div");
    keysToolbar.className = "stack-layer-keys-toolbar";
    var toolbarRight = document.createElement("div");
    toolbarRight.className = "stack-layer-key-toolbar-right";
    var keyMeta = document.createElement("span");
    keyMeta.className = "stack-layer-key-meta muted small";
    keyMeta.setAttribute("aria-live", "polite");
    toolbarRight.appendChild(keyMeta);
    var quickWrap = document.createElement("div");
    quickWrap.className = "stack-layer-key-quick";
    toolbarRight.appendChild(quickWrap);
    keysToolbar.appendChild(toolbarRight);
    keysBox.appendChild(keysToolbar);

    var filterInput = document.createElement("input");
    filterInput.type = "search";
    filterInput.className = "stack-layer-key-filter mono";
    filterInput.placeholder = "Filter by name…";
    filterInput.setAttribute("aria-label", "Filter variables");
    filterInput.hidden = true;
    keysBox.appendChild(filterInput);

    var keysScroll = document.createElement("div");
    keysScroll.className = "stack-layer-key-scroll";
    var keysList = document.createElement("div");
    keysList.className = "stack-layer-key-list";
    keysScroll.appendChild(keysList);
    keysBox.appendChild(keysScroll);

    keysScroll.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t && t.type === "checkbox" && t.closest(".stack-layer-key-list")) {
        scheduleRefreshPickListsBelow(index);
      }
    });

    body.appendChild(varsField);
    row.appendChild(body);

    function syncLayerFromDom() {
      layer.bundle = (bundleSel.value || "").trim();
      layer.mode = pickRb.checked ? "pick" : "all";
      layer.label = nameInput.value || "";
    }

    function applyKeyFilter() {
      var q = (filterInput.value || "").trim().toLowerCase();
      keysList.querySelectorAll(".stack-key-check").forEach(function (lab) {
        var k = (lab.getAttribute("data-key") || "").toLowerCase();
        lab.hidden = !!(q && k.indexOf(q) === -1);
      });
    }

    function populateKeyCheckboxes(keyNames, nativeKeySet) {
      keysList.innerHTML = "";
      quickWrap.innerHTML = "";
      layer.loadedKeys = keyNames.slice();
      filterInput.value = "";
      if (!keyNames.length) {
        keyMeta.textContent = "";
        filterInput.hidden = true;
        var empty = document.createElement("p");
        empty.className = "muted small stack-layer-key-empty";
        empty.textContent =
          index > 0
            ? "No variable names from this bundle or lower layers."
            : "No variables in this bundle yet.";
        keysList.appendChild(empty);
        return;
      }
      keyMeta.textContent = keyNames.length + " variable" + (keyNames.length === 1 ? "" : "s");
      filterInput.hidden = false;

      var selAll = document.createElement("button");
      selAll.type = "button";
      selAll.className = "link small";
      selAll.textContent = "All";
      selAll.title = "Select all";
      selAll.addEventListener("click", function () {
        keysList.querySelectorAll('input[type="checkbox"]').forEach(function (c) {
          if (!c.closest("label").hidden) c.checked = true;
        });
        scheduleRefreshPickListsBelow(index);
      });
      var clr = document.createElement("button");
      clr.type = "button";
      clr.className = "link small";
      clr.textContent = "None";
      clr.title = "Clear selection";
      clr.addEventListener("click", function () {
        keysList.querySelectorAll('input[type="checkbox"]').forEach(function (c) {
          c.checked = false;
        });
        scheduleRefreshPickListsBelow(index);
      });
      quickWrap.appendChild(selAll);
      quickWrap.appendChild(document.createTextNode(" "));
      quickWrap.appendChild(clr);

      keyNames.forEach(function (kn) {
        var lab = document.createElement("label");
        lab.className = "stack-key-check";
        lab.setAttribute("data-key", kn);
        var isForwarded =
          nativeKeySet && typeof nativeKeySet.has === "function" && !nativeKeySet.has(kn);
        if (isForwarded) {
          lab.classList.add("stack-key-check--forwarded");
        }
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = kn;
        cb.checked = layer.selected.indexOf(kn) >= 0;
        var span = document.createElement("span");
        span.className = "stack-key-check-name mono";
        span.textContent = kn;
        lab.appendChild(cb);
        lab.appendChild(span);
        if (isForwarded) {
          var pill = document.createElement("span");
          pill.className = "stack-key-check-pill";
          pill.textContent = "from lower layer(s)";
          pill.setAttribute("aria-hidden", "true");
          lab.appendChild(pill);
        }
        keysList.appendChild(lab);
      });
      applyKeyFilter();
    }

    filterInput.addEventListener("input", applyKeyFilter);

    function loadKeys() {
      syncStateFromDom();
      syncLayerFromDom();
      var bn = layer.bundle;
      if (!bn) {
        keysList.innerHTML = "";
        keyMeta.textContent = "";
        quickWrap.innerHTML = "";
        filterInput.hidden = true;
        var w = document.createElement("p");
        w.className = "error small stack-layer-key-empty";
        w.textContent = "Choose a bundle first.";
        keysList.appendChild(w);
        return;
      }
      keysList.innerHTML = "";
      keyMeta.textContent = "";
      quickWrap.innerHTML = "";
      filterInput.hidden = true;
      var loading = document.createElement("p");
      loading.className = "muted small stack-layer-key-empty";
      loading.textContent = "Loading…";
      keysList.appendChild(loading);

      function showLoadError() {
        keysList.innerHTML = "";
        keyMeta.textContent = "";
        quickWrap.innerHTML = "";
        filterInput.hidden = true;
        var err = document.createElement("p");
        err.className = "error small stack-layer-key-empty";
        err.textContent = "Could not load variable names.";
        keysList.appendChild(err);
      }

      if (index === 0) {
        fetchBundleKeyNames(bn)
          .then(function (keys) {
            var nativeSet = new Set(keys);
            populateKeyCheckboxes(keys, nativeSet);
          })
          .catch(showLoadError);
        return;
      }

      Promise.all([fetchBundleKeyNames(bn), forwardedKeyNamesBefore(index)])
        .then(function (pair) {
          var currentKeys = pair[0];
          var forwarded = pair[1];
          var nativeSet = new Set(currentKeys);
          var seen = {};
          var combined = [];
          function addKey(k) {
            var s = (k || "").trim();
            if (!s || seen[s]) return;
            seen[s] = true;
            combined.push(s);
          }
          forwarded.forEach(addKey);
          currentKeys.forEach(addKey);
          combined.sort(function (a, b) {
            return a.localeCompare(b);
          });
          populateKeyCheckboxes(combined, nativeSet);
        })
        .catch(showLoadError);
    }

    refreshPickListForLayer[index] = loadKeys;

    allRb.addEventListener("change", function () {
      syncLayerFromDom();
      keysBox.hidden = layer.mode !== "pick";
      scheduleRefreshPickListsBelow(index);
    });
    pickRb.addEventListener("change", function () {
      syncLayerFromDom();
      keysBox.hidden = layer.mode !== "pick";
      if (layer.mode === "pick" && layer.bundle) {
        loadKeys();
      }
      scheduleRefreshPickListsBelow(index);
    });

    bundleSel.addEventListener("change", function () {
      syncLayerFromDom();
      layer.loadedKeys = [];
      layer.selected = [];
      keysList.innerHTML = "";
      keyMeta.textContent = "";
      quickWrap.innerHTML = "";
      filterInput.value = "";
      filterInput.hidden = true;
      if (layer.mode === "pick" && layer.bundle) {
        loadKeys();
      }
      scheduleRefreshPickListsBelow(index);
    });

    if (layer.mode === "pick" && layer.bundle) {
      loadKeys();
    }

    return row;
  }

  function syncStateFromDom() {
    var rows = listEl.querySelectorAll(".stack-layer-row");
    rows.forEach(function (rowEl, index) {
      var layer = state.layers[index];
      if (!layer) return;
      var bundleSel = rowEl.querySelector(".stack-layer-bundle");
      layer.bundle = (bundleSel && bundleSel.value) || "";
      var labelIn = rowEl.querySelector(".stack-layer-label-input");
      layer.label = (labelIn && labelIn.value) || "";
      var pickRb = rowEl.querySelector('input[name="layer-keys-mode-' + index + '"][value="pick"]');
      layer.mode = pickRb && pickRb.checked ? "pick" : "all";
      if (layer.mode === "pick") {
        var pickBoxes = rowEl.querySelectorAll(".stack-layer-key-list input[type=checkbox]");
        // While names are still loading, the list has no checkboxes yet — do not
        // clear selected; otherwise a parallel upper-layer loadKeys() wipes state
        // and forwarded-key unions for lower "Selected only" layers become empty.
        if (pickBoxes.length > 0) {
          layer.selected = [];
          rowEl.querySelectorAll(".stack-layer-key-list input[type=checkbox]:checked").forEach(function (c) {
            layer.selected.push(c.value);
          });
        }
      } else {
        layer.selected = [];
      }
    });
  }

  function collectPayload() {
    syncStateFromDom();
    var out = [];
    for (var i = 0; i < state.layers.length; i++) {
      var layer = state.layers[i];
      var bn = (layer.bundle || "").trim();
      if (!bn) {
        return { error: "Each layer must have a bundle selected." };
      }
      if (layer.mode === "all") {
        var oa = { bundle: bn, keys: "*" };
        var la = (layer.label || "").trim();
        if (la) oa.label = la;
        out.push(oa);
      } else {
        if (!layer.selected || layer.selected.length === 0) {
          return {
            error:
              'Layer "' +
              bn +
              '": select at least one variable, or choose "All keys".',
          };
        }
        var op = { bundle: bn, keys: layer.selected.slice() };
        var lp = (layer.label || "").trim();
        if (lp) op.label = lp;
        out.push(op);
      }
    }
    if (!out.length) return { error: "Add at least one layer." };
    return { layers: out };
  }

  function renderAddButton() {
    var prev = root.querySelector(".stack-layers-add-wrap");
    if (prev) prev.remove();
    var wrap = document.createElement("p");
    wrap.className = "stack-layers-add-wrap";
    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "secondary";
    addBtn.textContent = "Add layer";
    addBtn.addEventListener("click", function () {
      syncStateFromDom();
      state.layers.push({
        bundle: "",
        mode: "all",
        selected: [],
        loadedKeys: [],
        label: "",
      });
      render();
    });
    wrap.appendChild(addBtn);
    root.appendChild(wrap);
  }

  function render() {
    listEl.innerHTML = "";
    refreshPickListForLayer = [];
    refreshBelowPendingMin = null;
    if (refreshBelowTimer) {
      clearTimeout(refreshBelowTimer);
      refreshBelowTimer = null;
    }
    state.layers.forEach(function (layer, index) {
      listEl.appendChild(renderRow(layer, index));
    });
    renderAddButton();
  }

  var form = root.closest("form");
  if (form && hiddenInput) {
    form.addEventListener("submit", function (e) {
      var result = collectPayload();
      if (result.error) {
        e.preventDefault();
        alert(result.error);
        return;
      }
      hiddenInput.value = JSON.stringify(result.layers);
    });
  }

  if (projectSelect) {
    projectSelect.addEventListener("change", function () {
      bundleKeyNamesCache = {};
      render();
    });
  }

  render();
})();
