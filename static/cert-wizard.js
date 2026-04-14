(function () {
  "use strict";

  var wizard = document.getElementById("cert-wizard");
  if (!wizard) return;

  var step = 1;
  var maxStep = 4;
  var panels = wizard.querySelectorAll(".cert-wizard-panel");
  var stepLabel = document.getElementById("cert-wizard-step-label");
  var osInputs = wizard.querySelectorAll('input[name="cert_wizard_os"]');
  var osPanels = wizard.querySelectorAll(".cert-wizard-os-instructions");

  function setStep(n) {
    step = Math.max(1, Math.min(maxStep, n));
    panels.forEach(function (p) {
      var ps = parseInt(p.getAttribute("data-panel"), 10);
      p.hidden = ps !== step;
    });
    if (stepLabel) {
      stepLabel.textContent = "Step " + step + " of " + maxStep;
    }
    if (step === 3) syncOsInstructions();
    if (step === 4) {
      var form = document.getElementById("cert-add-form");
      if (form) {
        try {
          form.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (e) {
          form.scrollIntoView(true);
        }
      }
    }
  }

  function selectedOs() {
    var v = "linux";
    osInputs.forEach(function (inp) {
      if (inp.checked) v = inp.value;
    });
    return v;
  }

  function syncOsInstructions() {
    var os = selectedOs();
    osPanels.forEach(function (p) {
      p.hidden = p.getAttribute("data-os-panel") !== os;
    });
  }

  wizard.addEventListener("click", function (e) {
    var next = e.target.closest(".cert-wizard-next");
    if (next && wizard.contains(next)) {
      e.preventDefault();
      var checked = document.querySelector('input[name="cert_wizard_os"]:checked');
      if (step === 2 && !checked) {
        var first = document.querySelector('input[name="cert_wizard_os"]');
        if (first) first.checked = true;
      }
      setStep(step + 1);
      return;
    }
    var back = e.target.closest(".cert-wizard-back");
    if (back && wizard.contains(back)) {
      e.preventDefault();
      setStep(step - 1);
      return;
    }
    var copyBtn = e.target.closest(".cert-wizard-copy");
    if (copyBtn && wizard.contains(copyBtn)) {
      e.preventDefault();
      var tid = copyBtn.getAttribute("data-copy-target");
      var pre = tid ? document.querySelector(tid) : null;
      if (!pre) return;
      var text = pre.textContent || "";
      if (!copyBtn.dataset.originalLabel) {
        copyBtn.dataset.originalLabel = copyBtn.textContent;
      }
      function restore() {
        copyBtn.textContent = copyBtn.dataset.originalLabel || "Copy";
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = "Copied";
          setTimeout(restore, 1500);
        }).catch(function () {
          fallbackCopy(text);
          copyBtn.textContent = "Copied";
          setTimeout(restore, 1500);
        });
      } else {
        fallbackCopy(text);
        copyBtn.textContent = "Copied";
        setTimeout(restore, 1500);
      }
    }
  });

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (err) {}
    document.body.removeChild(ta);
  }

  osInputs.forEach(function (inp) {
    inp.addEventListener("change", syncOsInstructions);
  });

  setStep(1);
})();
