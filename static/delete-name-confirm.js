/**
 * Require the user to type the exact resource name (or project slug) before submit.
 * Use on forms: data-delete-name="…" data-delete-kind="stack|bundle|project" onsubmit="return envelopeConfirmTypedName(this);"
 */
(function () {
  "use strict";

  var INTRO = {
    stack: "Delete this stack? Bundles are not deleted.",
    bundle: "Delete this bundle and all variables?",
    project: "Delete this project? Bundles become ungrouped (they are not deleted).",
  };

  function hintForKind(kind) {
    if (kind === "project") return "project slug";
    if (kind === "bundle") return "bundle name";
    if (kind === "stack") return "stack name";
    return "name";
  }

  window.envelopeConfirmTypedName = function (form) {
    if (!form || !form.getAttribute) return true;
    var expected = form.getAttribute("data-delete-name");
    if (!expected) return true;

    var kind = (form.getAttribute("data-delete-kind") || "").trim();
    var intro = INTRO[kind] || "This cannot be undone.";
    var hint = hintForKind(kind);
    var msg =
      intro +
      "\n\n" +
      "Type the " +
      hint +
      ' exactly to confirm (case-sensitive):\n"' +
      expected +
      '"';

    var typed = window.prompt(msg);
    if (typed === null) return false;
    if (typed !== expected) {
      window.alert("Text does not match. Nothing was deleted.");
      return false;
    }
    return true;
  };
})();
