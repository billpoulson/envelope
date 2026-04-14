(function () {
  "use strict";

  var root = document.getElementById("bundle-sealed-secrets-root");
  var dlg = document.getElementById("bundle-sealed-secret-modal");
  var form = document.getElementById("bundle-sealed-secret-form");
  if (!dlg || typeof dlg.showModal !== "function" || !form) return;

  var MAX_STEP = 4;
  var currentStep = 1;
  var openBtn = document.getElementById("bundle-sealed-secret-open");
  var cancelBtn = document.getElementById("bundle-sealed-secret-cancel");
  var btnBack = document.getElementById("sealed-wizard-back");
  var btnNext = document.getElementById("sealed-wizard-next");
  var btnSubmit = document.getElementById("sealed-wizard-submit");
  var steps = dlg.querySelectorAll(".sealed-wizard-step[data-sealed-step]");
  var wizardBody = dlg.querySelector(".sealed-wizard-body");

  var elKey = document.getElementById("sealed_key_name");
  var elAlg = document.getElementById("sealed_enc_alg");
  var elCt = document.getElementById("sealed_payload_ciphertext");
  var elNonce = document.getElementById("sealed_payload_nonce");
  var elAad = document.getElementById("sealed_payload_aad");
  var elRec = document.getElementById("sealed_recipients_json");

  function setStep(n) {
    currentStep = n;
    steps.forEach(function (el) {
      var s = parseInt(el.getAttribute("data-sealed-step"), 10);
      el.hidden = s !== n;
    });
    dlg.querySelectorAll("[data-step-indicator]").forEach(function (pill) {
      var s = parseInt(pill.getAttribute("data-step-indicator"), 10);
      pill.classList.toggle("is-active", s === n);
      pill.classList.toggle("is-complete", s < n);
      if (s === n) {
        pill.setAttribute("aria-current", "step");
      } else {
        pill.removeAttribute("aria-current");
      }
    });
    if (btnBack) btnBack.hidden = n <= 1;
    if (btnNext) btnNext.hidden = n >= MAX_STEP;
    if (btnSubmit) btnSubmit.hidden = n < MAX_STEP;
    if (wizardBody) wizardBody.scrollTop = 0;
  }

  function previewBlob(s, maxLen) {
    var t = (s || "").trim();
    if (!t) return "—";
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen) + "…";
  }

  function populateReview() {
    var rk = document.getElementById("sealed-review-key");
    var ra = document.getElementById("sealed-review-alg");
    var rc = document.getElementById("sealed-review-ct");
    var rn = document.getElementById("sealed-review-nonce");
    var rA = document.getElementById("sealed-review-aad");
    var rr = document.getElementById("sealed-review-recipients");
    if (rk) rk.textContent = (elKey && elKey.value.trim()) || "—";
    if (ra) ra.textContent = (elAlg && elAlg.value.trim()) || "—";
    if (rc) rc.textContent = previewBlob(elCt && elCt.value, 200);
    if (rn) rn.textContent = previewBlob(elNonce && elNonce.value, 120);
    if (rA) rA.textContent = previewBlob(elAad && elAad.value, 120);
    if (rr && elRec) rr.textContent = previewBlob(elRec.value, 400);
  }

  function validateStep(step) {
    if (step === 1) {
      if (!elKey || !elKey.value.trim()) {
        window.alert("Enter a key name.");
        if (elKey) elKey.focus();
        return false;
      }
      return true;
    }
    if (step === 2) {
      if (!elAlg || !elAlg.value.trim()) {
        window.alert("Enter the payload algorithm.");
        if (elAlg) elAlg.focus();
        return false;
      }
      if (!elCt || !elCt.value.trim()) {
        window.alert("Enter the payload ciphertext.");
        if (elCt) elCt.focus();
        return false;
      }
      if (!elNonce || !elNonce.value.trim()) {
        window.alert("Enter the payload nonce.");
        if (elNonce) elNonce.focus();
        return false;
      }
      return true;
    }
    if (step === 3) {
      if (!elRec || !elRec.value.trim()) {
        window.alert("Enter recipients JSON.");
        if (elRec) elRec.focus();
        return false;
      }
      try {
        var parsed = JSON.parse(elRec.value.trim());
        if (!Array.isArray(parsed) || parsed.length === 0) {
          window.alert("Recipients JSON must be a non-empty array.");
          if (elRec) elRec.focus();
          return false;
        }
      } catch (e) {
        window.alert("Recipients JSON must be valid JSON.");
        if (elRec) elRec.focus();
        return false;
      }
      return true;
    }
    return true;
  }

  function focusFirstInStep(step) {
    if (step === 4 && btnSubmit) {
      btnSubmit.focus();
      return;
    }
    var panel = dlg.querySelector('.sealed-wizard-step[data-sealed-step="' + step + '"]');
    if (!panel) return;
    var first = panel.querySelector(
      "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled])"
    );
    if (first) first.focus();
  }

  function openModal() {
    dlg.showModal();
    setStep(1);
    focusFirstInStep(1);
  }

  if (root && root.getAttribute("data-open-on-load") === "true") {
    dlg.showModal();
    setStep(1);
    focusFirstInStep(1);
  }

  if (openBtn) {
    openBtn.addEventListener("click", function () {
      dlg.showModal();
      setStep(1);
      focusFirstInStep(1);
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", function () {
      if (dlg.open) dlg.close();
      setStep(1);
    });
  }

  dlg.addEventListener("close", function () {
    setStep(1);
  });

  if (btnNext) {
    btnNext.addEventListener("click", function () {
      if (!validateStep(currentStep)) return;
      if (currentStep === 3) {
        populateReview();
      }
      if (currentStep < MAX_STEP) {
        setStep(currentStep + 1);
        focusFirstInStep(currentStep);
      }
    });
  }

  if (btnBack) {
    btnBack.addEventListener("click", function () {
      if (currentStep > 1) {
        setStep(currentStep - 1);
        focusFirstInStep(currentStep);
      }
    });
  }

  form.addEventListener(
    "submit",
    function (e) {
      if (currentStep !== MAX_STEP) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (!validateStep(1) || !validateStep(2) || !validateStep(3)) {
        e.preventDefault();
        return;
      }
    },
    true
  );

  form.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    if (e.target && e.target.tagName === "TEXTAREA") return;
    if (currentStep >= MAX_STEP) return;
    e.preventDefault();
    if (btnNext) btnNext.click();
  });
})();
