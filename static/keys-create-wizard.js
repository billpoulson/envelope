(function () {
  "use strict";

  var dialog = document.getElementById("key-create-dialog");
  var openBtn = document.getElementById("key-create-open");
  var form = document.getElementById("key-create-form");
  if (!dialog || !form || !openBtn) return;

  var steps = dialog.querySelectorAll(".key-wizard-step[data-wizard-step]");
  var btnBack = dialog.querySelector("[data-wizard-back]");
  var btnNext = dialog.querySelector("[data-wizard-next]");
  var btnCancel = dialog.querySelector("[data-wizard-cancel]");
  var btnSubmit = document.getElementById("key-wizard-submit");
  var nameInput = document.getElementById("name");
  var reviewName = document.getElementById("key-wizard-review-name");
  var reviewScopes = document.getElementById("key-wizard-review-scopes");
  var summaryEl = document.getElementById("scope-summary");
  var wizardBody = dialog.querySelector(".key-wizard-body");

  var currentStep = 1;
  var maxStep = 3;

  function setStep(n) {
    currentStep = n;
    steps.forEach(function (el) {
      var s = parseInt(el.getAttribute("data-wizard-step"), 10);
      el.hidden = s !== n;
    });
    if (btnBack) btnBack.hidden = n <= 1;
    if (btnNext) btnNext.hidden = n >= maxStep;
    if (btnSubmit) btnSubmit.hidden = n < maxStep;
    if (wizardBody) wizardBody.scrollTop = 0;
  }

  function populateReview() {
    if (reviewName && nameInput) {
      reviewName.textContent = (nameInput.value || "").trim();
    }
    if (reviewScopes && summaryEl) {
      reviewScopes.textContent = summaryEl.textContent || "";
    }
  }

  function openWizard() {
    setStep(1);
    if (typeof window.envelopeKeysScopes === "object" && window.envelopeKeysScopes.sync) {
      window.envelopeKeysScopes.sync();
    }
    if (nameInput) nameInput.focus();
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    }
  }

  function closeWizard() {
    if (typeof dialog.close === "function") {
      dialog.close();
    }
  }

  openBtn.addEventListener("click", openWizard);

  if (btnCancel) {
    btnCancel.addEventListener("click", closeWizard);
  }

  dialog.addEventListener("close", function () {
    setStep(1);
  });

  if (btnNext) {
    btnNext.addEventListener("click", function () {
      if (currentStep === 1) {
        var label = (nameInput && nameInput.value ? nameInput.value : "").trim();
        if (!label) {
          if (nameInput) nameInput.focus();
          return;
        }
        setStep(2);
        return;
      }
      if (currentStep === 2) {
        var api = window.envelopeKeysScopes;
        if (!api || typeof api.validate !== "function") {
          setStep(3);
          populateReview();
          return;
        }
        var v = api.validate();
        if (!v || !v.ok) {
          window.alert((v && v.message) || "Check permissions.");
          return;
        }
        setStep(3);
        populateReview();
      }
    });
  }

  if (btnBack) {
    btnBack.addEventListener("click", function () {
      if (currentStep > 1) {
        setStep(currentStep - 1);
      }
    });
  }

  form.addEventListener(
    "submit",
    function (e) {
      if (currentStep !== maxStep) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );
})();
