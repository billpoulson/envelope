(function () {
  "use strict";

  function parseFilename(contentDisposition) {
    if (!contentDisposition) return null;
    var mStar = /filename\*=UTF-8''([^;\s]+)/i.exec(contentDisposition);
    if (mStar) {
      try {
        return decodeURIComponent(mStar[1].replace(/^"+|"+$/g, ""));
      } catch (e) {
        return null;
      }
    }
    var m = /filename="([^"]+)"/.exec(contentDisposition);
    if (m) return m[1];
    m = /filename=([^;\s]+)/.exec(contentDisposition);
    return m ? m[1].replace(/^"+|"+$/g, "") : null;
  }

  function triggerBlobDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || "envelope-download";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  document.querySelectorAll("form.backup-download-form").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var label = btn ? btn.textContent : "Download";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Preparing…";
      }
      var fd = new FormData(form);
      fetch(form.action, {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      })
        .then(function (resp) {
          var ct = (resp.headers.get("content-type") || "").toLowerCase();
          if (resp.status === 401 || resp.status === 403) {
            return resp.text().then(function (t) {
              throw new Error(t || "Access denied — sign in again from the home page.");
            });
          }
          if (!resp.ok) {
            return resp.text().then(function (t) {
              throw new Error((t && t.slice(0, 400)) || "Request failed (" + resp.status + ")");
            });
          }
          if (ct.indexOf("text/html") !== -1) {
            return resp.text().then(function () {
              throw new Error("Got HTML instead of a file — session may have expired. Reload and sign in.");
            });
          }
          var fn = parseFilename(resp.headers.get("Content-Disposition"));
          return resp.blob().then(function (blob) {
            triggerBlobDownload(blob, fn || "envelope-backup");
          });
        })
        .catch(function (err) {
          window.alert(err.message || String(err));
        })
        .finally(function () {
          if (btn) {
            btn.disabled = false;
            btn.textContent = label;
          }
        });
    });
  });
})();
