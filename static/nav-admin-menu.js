(function () {
  "use strict";

  function closeAllNavMenus() {
    document.querySelectorAll("details.nav-menu[open]").forEach(function (d) {
      d.open = false;
    });
  }

  document.querySelectorAll("details.nav-menu").forEach(function (details) {
    details.addEventListener("click", function (e) {
      var a = e.target.closest("a");
      if (!a || !details.contains(a)) return;
      if (!a.closest(".nav-menu-panel")) return;
      details.open = false;
    });
  });

  document.addEventListener(
    "click",
    function (e) {
      if (e.target.closest("details.nav-menu")) return;
      closeAllNavMenus();
    },
    true
  );

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    closeAllNavMenus();
  });
})();
