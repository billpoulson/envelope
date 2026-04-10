(function () {
  "use strict";

  var genDlg = document.getElementById("bundle-env-link-generate-modal");
  var genOpen = document.getElementById("bundle-env-link-open");
  var genCancel = document.getElementById("bundle-env-link-generate-cancel");
  if (!genDlg || typeof genDlg.showModal !== "function") return;

  if (genOpen) {
    genOpen.addEventListener("click", function () {
      genDlg.showModal();
      var submitBtn = genDlg.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.focus();
    });
  }
  if (genCancel) {
    genCancel.addEventListener("click", function () {
      if (genDlg.open) genDlg.close();
    });
  }

  var resDlg = document.getElementById("bundle-env-link-result-modal");
  if (resDlg && typeof resDlg.showModal === "function") {
    resDlg.showModal();
    var closeBtn = document.getElementById("bundle-env-link-result-close");
    var copyBtn = document.getElementById("bundle-env-link-result-copy");
    var urlEl = document.getElementById("bundle-env-link-result-url");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        if (resDlg.open) resDlg.close();
      });
    }
    if (copyBtn && urlEl) {
      copyBtn.addEventListener("click", function () {
        var text = urlEl.getAttribute("href") || urlEl.textContent || "";
        if (!text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(function () {});
        }
      });
    }
  }
})();
