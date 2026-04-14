(function () {
  "use strict";

  var root = document.getElementById("stack-key-graph-root");
  if (!root) return;

  var fetchUrl = root.getAttribute("data-fetch-url");
  if (!fetchUrl) {
    root.innerHTML = "<p class=\"error\">Missing graph data URL.</p>";
    return;
  }

  var cachedPayload = null;
  var graphOpts = { showSecretValues: false };
  /** Layer or merged <td> -> { raw, keyName, label, kind } for context menu "View secret". */
  var graphSecretCells = new WeakMap();

  /**
   * Parse a value that looks like JSON (object, array, or double-encoded JSON string).
   * Returns an object/array or null.
   */
  function parseJsonish(raw) {
    var s = String(raw).trim();
    if (s.length < 2) return null;
    var c0 = s.charAt(0);
    if (c0 !== "{" && c0 !== "[" && c0 !== '"') return null;

    var v;
    try {
      v = JSON.parse(s);
    } catch (e) {
      return null;
    }

    if (typeof v === "string") {
      var inner = v.trim();
      if (inner.length < 2) return null;
      var i0 = inner.charAt(0);
      if (i0 !== "{" && i0 !== "[") return null;
      try {
        v = JSON.parse(inner);
      } catch (e2) {
        return null;
      }
    }

    if (v !== null && typeof v === "object") {
      return v;
    }
    return null;
  }

  /**
   * Format parsed JSON for display: indented objects; arrays of primitives as a bullet list;
   * nested arrays/objects as pretty JSON.
   */
  function formatParsedValue(v) {
    if (Array.isArray(v)) {
      if (v.length === 0) {
        return { ok: true, text: "[ ]", mode: "json" };
      }
      var onlyPrimitives = v.every(function (item) {
        return (
          item === null ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
        );
      });
      if (onlyPrimitives) {
        var lines = v.map(function (item) {
          if (item === null) return "• null";
          return "• " + String(item);
        });
        return { ok: true, text: lines.join("\n"), mode: "list" };
      }
      return { ok: true, text: JSON.stringify(v, null, 2), mode: "json" };
    }

    if (typeof v === "object" && v !== null) {
      return { ok: true, text: JSON.stringify(v, null, 2), mode: "json" };
    }

    return null;
  }

  function tryPrettyJson(raw) {
    var s = String(raw);
    var parsed = parseJsonish(raw);
    if (parsed === null) {
      return { ok: false, text: s };
    }
    var out = formatParsedValue(parsed);
    if (!out) {
      return { ok: false, text: s };
    }
    return out;
  }

  /** Append formatted content to `valueWrap`; `td` receives layout classes (e.g. json). */
  function appendFormattedValue(td, valueWrap, raw, extraClass) {
    var pj = tryPrettyJson(raw);
    var ec = extraClass ? " " + extraClass : "";
    if (pj.ok) {
      td.classList.add("stack-graph-cell--json");
      var pre = document.createElement("pre");
      pre.className = "stack-graph-json mono" + ec;
      if (pj.mode === "list") {
        pre.classList.add("stack-graph-json--list");
      }
      pre.textContent = pj.text;
      valueWrap.appendChild(pre);
    } else {
      var node = document.createElement("div");
      node.className = "stack-graph-node mono" + ec;
      node.textContent = pj.text;
      valueWrap.appendChild(node);
    }
  }

  function hasProvidedCellValue(v) {
    if (v == null) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    return true;
  }

  function makeNoValueSquare(title) {
    var s = document.createElement("span");
    s.className = "stack-graph-no-value-marker";
    s.setAttribute("aria-label", title || "No value");
    s.title = title || "No value in any layer";
    return s;
  }

  /** bundle `…/edit` → POST target `…/secrets/add` */
  function secretsAddUrlFromEditPath(editBase) {
    if (!editBase) return "";
    var s = String(editBase);
    if (s.endsWith("/edit")) {
      return s.slice(0, -4) + "secrets/add";
    }
    return "";
  }

  function getCsrfToken() {
    return root.getAttribute("data-csrf-token") || "";
  }

  var defineModalEl = null;
  var defineModalMeta = null;
  var defineModalValue = null;
  var defineModalStorage = null;
  var defineModalPostUrl = null;
  var defineModalKeyName = null;

  function submitDefineValue(postUrl, keyName, value, isSecret, csrf) {
    var fd = new FormData();
    fd.append("key_name", keyName);
    fd.append("value", value);
    fd.append("csrf", csrf);
    fd.append("is_secret", isSecret ? "1" : "0");
    return fetch(postUrl, {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      redirect: "manual",
    }).then(function (r) {
      if (r.status === 302 || r.status === 303) return;
      if (r.status === 0) return;
      if (r.ok) return;
      return r.text().then(function (t) {
        throw new Error(
          (t && String(t).trim().slice(0, 200)) || "Save failed (" + r.status + ")"
        );
      });
    });
  }

  function ensureDefineModal() {
    if (defineModalEl) return defineModalEl;
    var d = document.createElement("dialog");
    d.id = "stack-graph-define-modal";
    d.className = "modal-dialog";
    d.setAttribute("aria-labelledby", "stack-graph-define-title");
    d.setAttribute("aria-modal", "true");

    var form = document.createElement("form");
    form.className = "stack modal-form";
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
    });

    var title = document.createElement("h2");
    title.id = "stack-graph-define-title";
    title.className = "h3 modal-title";
    title.textContent = "Define value in layer";

    defineModalMeta = document.createElement("p");
    defineModalMeta.className = "muted small";

    var ls = document.createElement("label");
    ls.htmlFor = "stack-graph-define-storage";
    ls.textContent = "Storage";
    defineModalStorage = document.createElement("select");
    defineModalStorage.id = "stack-graph-define-storage";
    var o1 = document.createElement("option");
    o1.value = "1";
    o1.textContent = "Encrypted (secret)";
    var o0 = document.createElement("option");
    o0.value = "0";
    o0.textContent = "Plain (not encrypted)";
    defineModalStorage.appendChild(o1);
    defineModalStorage.appendChild(o0);

    var lv = document.createElement("label");
    lv.htmlFor = "stack-graph-define-value";
    lv.textContent = "Value";
    defineModalValue = document.createElement("textarea");
    defineModalValue.id = "stack-graph-define-value";
    defineModalValue.rows = 5;
    defineModalValue.required = true;
    defineModalValue.setAttribute("aria-required", "true");

    var actions = document.createElement("p");
    actions.className = "form-actions";
    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary-outline";
    cancelBtn.textContent = "Cancel";

    saveBtn.addEventListener("click", function () {
      if (!defineModalPostUrl || !defineModalKeyName) {
        d.close();
        return;
      }
      var raw = defineModalValue ? defineModalValue.value : "";
      if (!String(raw).trim()) {
        if (defineModalValue) defineModalValue.focus();
        return;
      }
      var csrf = getCsrfToken();
      if (!csrf) {
        window.alert("Missing CSRF token — refresh the page and try again.");
        return;
      }
      var isSec = defineModalStorage && defineModalStorage.value === "1";
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      submitDefineValue(
        defineModalPostUrl,
        defineModalKeyName,
        raw,
        isSec,
        csrf
      )
        .then(function () {
          d.close();
          refetchGraph();
        })
        .catch(function (err) {
          window.alert(err && err.message ? err.message : String(err));
        })
        .finally(function () {
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
        });
    });

    cancelBtn.addEventListener("click", function () {
      d.close();
    });

    d.addEventListener("cancel", function (ev) {
      ev.preventDefault();
      d.close();
    });

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    form.appendChild(title);
    form.appendChild(defineModalMeta);
    form.appendChild(ls);
    form.appendChild(defineModalStorage);
    form.appendChild(lv);
    form.appendChild(defineModalValue);
    form.appendChild(actions);
    d.appendChild(form);
    document.body.appendChild(d);
    defineModalEl = d;
    return d;
  }

  function openDefineValueModal(opts) {
    var postUrl = opts && opts.postUrl;
    var keyName = opts && opts.keyName;
    var bundleName = opts && opts.bundleName;
    if (!postUrl || !keyName) return;
    defineModalPostUrl = postUrl;
    defineModalKeyName = keyName;
    var dlg = ensureDefineModal();
    if (defineModalMeta) {
      defineModalMeta.textContent =
        "Variable " + keyName + " · bundle " + (bundleName || "");
    }
    if (defineModalValue) {
      defineModalValue.value = "";
    }
    if (defineModalStorage) {
      defineModalStorage.value = "1";
    }
    dlg.showModal();
    if (defineModalValue) {
      defineModalValue.focus();
    }
  }

  var viewSecretModalEl = null;
  var viewSecretMetaEl = null;
  var viewSecretTextareaEl = null;

  function ensureViewSecretModal() {
    if (viewSecretModalEl) return viewSecretModalEl;
    var d = document.createElement("dialog");
    d.className = "modal-dialog stack-graph-view-secret-dialog";
    d.setAttribute("aria-labelledby", "stack-graph-view-secret-title");
    d.setAttribute("aria-modal", "true");

    var title = document.createElement("h2");
    title.id = "stack-graph-view-secret-title";
    title.className = "h3 modal-title";
    title.textContent = "Secret value";

    viewSecretMetaEl = document.createElement("p");
    viewSecretMetaEl.className = "muted small";

    var ta = document.createElement("textarea");
    ta.className = "mono stack-graph-view-secret-textarea";
    ta.readOnly = true;
    ta.rows = 14;
    ta.setAttribute("aria-label", "Revealed secret value");
    viewSecretTextareaEl = ta;

    var actions = document.createElement("p");
    actions.className = "form-actions";
    var copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "secondary-outline";
    closeBtn.textContent = "Close";

    copyBtn.addEventListener("click", function () {
      var t = viewSecretTextareaEl ? viewSecretTextareaEl.value : "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).catch(function () {
          try {
            viewSecretTextareaEl.select();
            document.execCommand("copy");
          } catch (e) {}
        });
      } else {
        try {
          viewSecretTextareaEl.select();
          document.execCommand("copy");
        } catch (e2) {}
      }
    });
    closeBtn.addEventListener("click", function () {
      d.close();
    });
    d.addEventListener("cancel", function (ev) {
      ev.preventDefault();
      d.close();
    });

    actions.appendChild(copyBtn);
    actions.appendChild(closeBtn);
    d.appendChild(title);
    d.appendChild(viewSecretMetaEl);
    d.appendChild(ta);
    d.appendChild(actions);
    document.body.appendChild(d);
    viewSecretModalEl = d;
    return d;
  }

  function openViewSecretModal(payload) {
    if (!payload || payload.raw === undefined || payload.raw === null) return;
    var dlg = ensureViewSecretModal();
    if (viewSecretMetaEl) {
      var loc =
        payload.kind === "merged"
          ? payload.keyName + " · merged export"
          : payload.keyName + " · " + (payload.label || "");
      viewSecretMetaEl.textContent = loc;
    }
    if (viewSecretTextareaEl) {
      viewSecretTextareaEl.value = String(payload.raw);
    }
    dlg.showModal();
    if (viewSecretTextareaEl) {
      viewSecretTextareaEl.focus();
    }
  }

  /** If `isSecret` and secrets are not revealed, show a placeholder (no literal in the DOM). */
  function appendSecretOrFormatted(
    td,
    valueWrap,
    raw,
    extraClass,
    isSecret,
    showSecrets
  ) {
    if (isSecret && !showSecrets) {
      var ph = document.createElement("span");
      ph.className = "stack-graph-secret-placeholder muted";
      ph.textContent = "(secret)";
      ph.title =
        'Right-click this cell and choose "View secret…", or enable "Show secret values" above';
      ph.setAttribute("aria-label", "Secret value hidden");
      valueWrap.appendChild(ph);
      return;
    }
    appendFormattedValue(td, valueWrap, raw, extraClass);
  }

  function buildGraph(payload, opts) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      root.innerHTML = "<p class=\"error\">Invalid graph data.</p>";
      return;
    }
    var o = opts || graphOpts;
    var showSecrets = o.showSecretValues === true;
    root.innerHTML = "";
    var layers = payload.layers || [];
    var rows = payload.rows || [];
    var n = layers.length;

    if (n === 0) {
      root.innerHTML = "<p class=\"muted\">This stack has no layers.</p>";
      return;
    }

    var outer = document.createElement("div");
    outer.className = "stack-graph-outer";

    var toolbar = document.createElement("div");
    toolbar.className = "stack-graph-toolbar";
    var filter = document.createElement("input");
    filter.type = "search";
    filter.className = "stack-graph-filter mono";
    filter.placeholder = "Filter by variable name…";
    filter.setAttribute("aria-label", "Filter keys");
    toolbar.appendChild(filter);

    var showSecretsLabel = document.createElement("label");
    showSecretsLabel.className = "stack-graph-toolbar-show-secrets";
    var showSecretsCb = document.createElement("input");
    showSecretsCb.type = "checkbox";
    showSecretsCb.checked = graphOpts.showSecretValues;
    showSecretsCb.setAttribute("aria-label", "Show secret variable values");
    var showSecretsSpan = document.createElement("span");
    showSecretsSpan.textContent = "Show secret values";
    showSecretsLabel.appendChild(showSecretsCb);
    showSecretsLabel.appendChild(showSecretsSpan);
    showSecretsCb.addEventListener("change", function () {
      graphOpts.showSecretValues = showSecretsCb.checked;
      if (cachedPayload) {
        buildGraph(cachedPayload);
      }
    });
    toolbar.appendChild(showSecretsLabel);

    outer.appendChild(toolbar);

    var scroll = document.createElement("div");
    scroll.className = "stack-graph-body";

    if (rows.length === 0) {
      var empty = document.createElement("p");
      empty.className = "muted stack-graph-empty";
      empty.textContent = "No variables in any layer.";
      scroll.appendChild(empty);
      outer.appendChild(scroll);
      root.appendChild(outer);
      return;
    }

    var table = document.createElement("table");
    table.className = "stack-graph-table";
    table.setAttribute("aria-label", "Stack variables by layer");

    var cg = document.createElement("colgroup");
    var colKey = document.createElement("col");
    colKey.className = "stack-graph-col-key";
    cg.appendChild(colKey);
    var layerCols = [];
    for (var ci = 0; ci < n; ci++) {
      var colL = document.createElement("col");
      colL.className = "stack-graph-col-layer";
      colL.setAttribute("data-layer-col", String(ci));
      layerCols.push(colL);
      cg.appendChild(colL);
    }
    var colM = document.createElement("col");
    colM.className = "stack-graph-col-merged";
    cg.appendChild(colM);
    table.appendChild(cg);

    var layerRefs = [];

    function applyLayerCollapse(layerIndex, collapsed) {
      var ref = layerRefs[layerIndex];
      if (!ref) return;
      var th = ref.th;
      var colEl = ref.colEl;
      var btn = ref.btn;
      var bundleName = ref.bundleName;
      var colTitle = ref.columnTitle || bundleName;
      th.classList.toggle("stack-graph-th--collapsed", collapsed);
      if (colEl) colEl.classList.toggle("stack-graph-col-layer--collapsed", collapsed);
      table.querySelectorAll('td[data-layer-col="' + layerIndex + '"]').forEach(function (td) {
        td.classList.toggle("stack-graph-td--col-collapsed", collapsed);
      });
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.textContent = collapsed ? "▶" : "▼";
      btn.setAttribute(
        "aria-label",
        (collapsed ? "Expand column: " : "Collapse column: ") + colTitle
      );
      btn.setAttribute(
        "title",
        collapsed ? "Show this layer column" : "Hide this layer column"
      );
    }

    var thead = document.createElement("thead");
    var headTr = document.createElement("tr");

    var thCorner = document.createElement("th");
    thCorner.className = "stack-graph-th stack-graph-th--corner muted small";
    thCorner.scope = "col";
    thCorner.textContent = "Variable";
    headTr.appendChild(thCorner);

    for (var hi = 0; hi < n; hi++) {
      (function (layerIndex) {
        var meta = layers[layerIndex];
        var bundleName = meta && meta.bundle != null ? String(meta.bundle) : "Layer " + (layerIndex + 1);
        var displayLabel =
          meta && meta.display_label != null && String(meta.display_label).trim()
            ? String(meta.display_label).trim()
            : "";
        var headerPrimary = displayLabel || bundleName;

        var th = document.createElement("th");
        th.className = "stack-graph-th stack-graph-th--layer";
        th.scope = "col";
        th.setAttribute("data-layer-col", String(layerIndex));

        var bar = document.createElement("div");
        bar.className = "stack-graph-th-layer-bar";

        var tools = document.createElement("div");
        tools.className = "stack-graph-th-layer-tools";

        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "stack-graph-layer-toggle secondary-outline small";
        btn.setAttribute("aria-expanded", "false");
        btn.setAttribute("aria-label", "Expand column: " + headerPrimary);
        btn.setAttribute("title", "Show this layer column");
        btn.textContent = "▶";

        var content = document.createElement("div");
        content.className = "stack-graph-th-layer-content";

        var hb = document.createElement("div");
        hb.className = "stack-graph-hbundle" + (displayLabel ? "" : " mono");
        hb.textContent = headerPrimary;
        if (displayLabel) {
          var hbSub = document.createElement("div");
          hbSub.className = "stack-graph-hbundle-sub mono muted small";
          hbSub.textContent = bundleName;
          content.appendChild(hbSub);
        }
        var arr = document.createElement("div");
        arr.className = "stack-graph-layer-arrow";
        arr.setAttribute("aria-hidden", "true");
        arr.textContent = "→";

        content.insertBefore(hb, content.firstChild);
        content.appendChild(arr);
        tools.appendChild(btn);
        bar.appendChild(tools);
        bar.appendChild(content);
        th.classList.add("stack-graph-th--collapsed");
        th.appendChild(bar);
        headTr.appendChild(th);

        var colEl = layerCols[layerIndex];
        if (colEl) colEl.classList.add("stack-graph-col-layer--collapsed");
        layerRefs[layerIndex] = {
          th: th,
          colEl: colEl,
          btn: btn,
          bundleName: bundleName,
          columnTitle: headerPrimary
        };
        btn.addEventListener("click", function () {
          var collapsed = th.classList.contains("stack-graph-th--collapsed");
          applyLayerCollapse(layerIndex, !collapsed);
        });
      })(hi);
    }

    var thMerged = document.createElement("th");
    thMerged.className = "stack-graph-th stack-graph-th--merged";
    thMerged.scope = "col";
    var hbM = document.createElement("div");
    hbM.className = "stack-graph-hbundle";
    hbM.textContent = "Merged export";
    var hlM = document.createElement("div");
    hlM.className = "stack-graph-hlabel muted small";
    hlM.textContent = "Final value after layers";
    thMerged.appendChild(hbM);
    thMerged.appendChild(hlM);
    headTr.appendChild(thMerged);

    thead.appendChild(headTr);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");

    rows.forEach(function (row) {
      var key = row.key != null ? String(row.key) : "";
      var cells = row.cells || [];
      var cellSecrets = row.cell_secrets || [];
      var win = row.winner_layer_index;
      var merged = Object.prototype.hasOwnProperty.call(row, "merged")
        ? row.merged
        : win != null
          ? cells[win]
          : null;
      var mergedIsSecret = row.merged_secret === true;

      var rowNoValueAnywhere = true;
      for (var ri = 0; ri < n; ri++) {
        if (hasProvidedCellValue(cells[ri])) {
          rowNoValueAnywhere = false;
          break;
        }
      }

      var tr = document.createElement("tr");
      tr.setAttribute("data-key-lower", key.toLowerCase());

      var thKey = document.createElement("th");
      thKey.className = "stack-graph-key mono";
      thKey.scope = "row";
      thKey.textContent = key;
      tr.appendChild(thKey);

      for (var li = 0; li < n; li++) {
        var cell = document.createElement("td");
        cell.className = "stack-graph-cell stack-graph-cell--layer stack-graph-td--col-collapsed";
        cell.setAttribute("data-layer-col", String(li));
        var v = cells[li];
        var layerMeta = layers[li] || {};
        var editBase =
          layerMeta.bundle_edit_path != null
            ? String(layerMeta.bundle_edit_path)
            : "";
        var bundleLabel =
          layerMeta.bundle != null
            ? String(layerMeta.bundle)
            : "Layer " + (li + 1);
        var addUrl =
          rowNoValueAnywhere && editBase
            ? secretsAddUrlFromEditPath(editBase)
            : "";
        var hasValue = hasProvidedCellValue(v);
        var overriddenByNext =
          li < n - 1 && hasValue && hasProvidedCellValue(cells[li + 1]);
        var notOverriddenByNext = hasValue && !overriddenByNext;
        if (overriddenByNext) {
          cell.setAttribute("data-override-next", "1");
        }
        if (notOverriddenByNext) {
          cell.setAttribute("data-keep-vs-next", "1");
        }

        var valueWrap = document.createElement("div");
        valueWrap.className = "stack-graph-cell-value";

        if (v != null) {
          if (win === li) cell.classList.add("stack-graph-cell--winner");
          var isSec = cellSecrets[li] === true;
          appendSecretOrFormatted(
            cell,
            valueWrap,
            v,
            "",
            isSec,
            showSecrets
          );
          if (isSec) {
            graphSecretCells.set(cell, {
              raw: String(v),
              keyName: key,
              label: bundleLabel,
              kind: "layer",
            });
          }
        } else {
          cell.classList.add("stack-graph-cell--empty");
          if (rowNoValueAnywhere) {
            valueWrap.appendChild(
              makeNoValueSquare("No value in any layer")
            );
          } else {
            var emptyAr = document.createElement("span");
            emptyAr.className = "stack-graph-cell-empty-arrow muted";
            emptyAr.textContent = "→";
            emptyAr.title = "Not defined in this bundle";
            valueWrap.appendChild(emptyAr);
          }
        }

        if (addUrl) {
          cell.setAttribute("data-secrets-add-url", addUrl);
          cell.setAttribute("data-define-key", key);
          cell.setAttribute("data-define-bundle", bundleLabel);
        }

        var strip = document.createElement("div");
        strip.className = "stack-graph-cell-collapsed-strip";
        strip.setAttribute("aria-hidden", "true");
        if (!hasValue) {
          if (rowNoValueAnywhere) {
            strip.appendChild(
              makeNoValueSquare("No value in any layer")
            );
          } else {
            var emptyArStrip = document.createElement("span");
            emptyArStrip.className = "stack-graph-cell-empty-arrow muted";
            emptyArStrip.textContent = "→";
            emptyArStrip.title = "Not defined in this bundle";
            strip.appendChild(emptyArStrip);
          }
        }
        if (overriddenByNext) {
          var markerY = document.createElement("span");
          markerY.className = "stack-graph-override-marker";
          markerY.title = "Overridden by the next layer (above)";
          markerY.setAttribute("aria-label", "Overridden by next layer");
          strip.appendChild(markerY);
        } else if (notOverriddenByNext) {
          var markerG = document.createElement("span");
          markerG.className = "stack-graph-keep-marker";
          markerG.title =
            li === n - 1
              ? "Top layer: nothing above overrides this value for this key"
              : "Next layer does not define this key — not overridden above";
          markerG.setAttribute("aria-label", "Not overridden by next layer");
          strip.appendChild(markerG);
        }

        if (hasValue && editBase) {
          cell.setAttribute(
            "data-edit-href",
            editBase + "?key=" + encodeURIComponent(key)
          );
        }

        var ctxHint = [];
        if (v != null && cellSecrets[li] === true) ctxHint.push("view secret");
        if (addUrl) ctxHint.push("define value in this layer");
        if (hasValue && editBase) ctxHint.push("edit in source bundle");
        if (ctxHint.length) {
          cell.title = "Right-click: " + ctxHint.join(" · ");
        }

        cell.appendChild(valueWrap);
        cell.appendChild(strip);
        tr.appendChild(cell);
      }

      var tdMerged = document.createElement("td");
      tdMerged.className = "stack-graph-cell stack-graph-cell--merged";
      var mergedWrap = document.createElement("div");
      mergedWrap.className = "stack-graph-cell-value stack-graph-cell-value--merged";
      if (hasProvidedCellValue(merged)) {
        appendSecretOrFormatted(
          tdMerged,
          mergedWrap,
          merged,
          "stack-graph-node--merged",
          mergedIsSecret,
          showSecrets
        );
        if (mergedIsSecret) {
          graphSecretCells.set(tdMerged, {
            raw: String(merged),
            keyName: key,
            label: "Merged export",
            kind: "merged",
          });
          tdMerged.title = "Right-click: view secret";
        }
      } else {
        tdMerged.classList.add("stack-graph-cell--empty");
        mergedWrap.appendChild(
          makeNoValueSquare("No value in any layer")
        );
      }
      tdMerged.appendChild(mergedWrap);
      tr.appendChild(tdMerged);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    scroll.appendChild(table);
    outer.appendChild(scroll);
    root.appendChild(outer);

    filter.addEventListener("input", function () {
      var q = (filter.value || "").trim().toLowerCase();
      tbody.querySelectorAll("tr").forEach(function (r) {
        var k = r.getAttribute("data-key-lower") || "";
        r.hidden = !!(q && k.indexOf(q) === -1);
      });
    });
  }

  function refetchGraph() {
    return fetch(fetchUrl, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error(r.statusText || String(r.status));
        return r.json();
      })
      .then(function (payload) {
        cachedPayload = payload;
        buildGraph(cachedPayload);
      })
      .catch(function (err) {
        console.error("stack-key-graph refetch:", err);
        window.alert(
          err && err.message
            ? "Could not refresh the graph: " + err.message
            : "Could not refresh the graph. Try reloading the page."
        );
      });
  }

  fetch(fetchUrl, { credentials: "same-origin" })
    .then(function (r) {
      if (!r.ok) throw new Error(r.statusText || String(r.status));
      return r.json();
    })
    .then(function (payload) {
      try {
        cachedPayload = payload;
        buildGraph(payload);
      } catch (e) {
        console.error("stack-key-graph:", e);
        root.innerHTML =
          "<p class=\"error\">Could not render key graph.</p><p class=\"muted small\">" +
          String(e && e.message ? e.message : e) +
          "</p>";
      }
    })
    .catch(function (e) {
      console.error("stack-key-graph fetch:", e);
      root.innerHTML =
        "<p class=\"error\">Could not load key graph.</p><p class=\"muted small\">" +
        String(e && e.message ? e.message : e) +
        "</p>";
    });

  var contextMenuEl = null;

  function stackGraphHideContextMenu() {
    if (contextMenuEl) contextMenuEl.hidden = true;
  }

  function stackGraphShowContextMenu(x, y, opts) {
    var editHref = opts && opts.editHref;
    var defineOpts = opts && opts.define;
    var viewSecret = opts && opts.viewSecret;
    if (
      !editHref &&
      (!defineOpts || !defineOpts.postUrl) &&
      !(viewSecret && Object.prototype.hasOwnProperty.call(viewSecret, "raw"))
    ) {
      return;
    }
    if (!contextMenuEl) {
      contextMenuEl = document.createElement("div");
      contextMenuEl.className = "stack-graph-context-menu";
      contextMenuEl.setAttribute("role", "menu");
      contextMenuEl.hidden = true;
      document.body.appendChild(contextMenuEl);
    }
    contextMenuEl.innerHTML = "";
    if (viewSecret && Object.prototype.hasOwnProperty.call(viewSecret, "raw")) {
      var vsBtn = document.createElement("button");
      vsBtn.type = "button";
      vsBtn.className = "stack-graph-context-menu__btn";
      vsBtn.setAttribute("role", "menuitem");
      vsBtn.textContent = "View secret…";
      vsBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        stackGraphHideContextMenu();
        openViewSecretModal(viewSecret);
      });
      contextMenuEl.appendChild(vsBtn);
    }
    if (editHref) {
      var link = document.createElement("a");
      link.className = "stack-graph-context-menu__link";
      link.setAttribute("role", "menuitem");
      link.href = editHref;
      link.textContent = "Edit in source bundle…";
      contextMenuEl.appendChild(link);
    }
    if (defineOpts && defineOpts.postUrl) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stack-graph-context-menu__btn";
      btn.setAttribute("role", "menuitem");
      btn.textContent = "Define value in this layer…";
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        stackGraphHideContextMenu();
        openDefineValueModal({
          postUrl: defineOpts.postUrl,
          keyName: defineOpts.keyName,
          bundleName: defineOpts.bundleName,
        });
      });
      contextMenuEl.appendChild(btn);
    }
    contextMenuEl.style.left = x + "px";
    contextMenuEl.style.top = y + "px";
    contextMenuEl.hidden = false;
  }

  document.addEventListener(
    "contextmenu",
    function (e) {
      if (!root || !root.contains(e.target)) return;
      var td = e.target.closest(
        "td.stack-graph-cell--layer, td.stack-graph-cell--merged"
      );
      if (!td) return;
      var href = td.getAttribute("data-edit-href");
      var addUrl = td.getAttribute("data-secrets-add-url");
      var viewSecret = graphSecretCells.get(td);
      if (!href && !addUrl && !viewSecret) return;
      e.preventDefault();
      stackGraphShowContextMenu(e.clientX, e.clientY, {
        editHref: href || null,
        define: addUrl
          ? {
              postUrl: addUrl,
              keyName: td.getAttribute("data-define-key") || "",
              bundleName: td.getAttribute("data-define-bundle") || "",
            }
          : null,
        viewSecret: viewSecret || null,
      });
    },
    true
  );

  document.addEventListener("click", function (e) {
    if (contextMenuEl && !contextMenuEl.contains(e.target)) {
      stackGraphHideContextMenu();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") stackGraphHideContextMenu();
  });
  window.addEventListener("scroll", stackGraphHideContextMenu, true);
})();
