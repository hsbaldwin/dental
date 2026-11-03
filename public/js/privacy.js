fetch("api/site").then(function (r) { return r.json(); }).then(function (s) {
  var data = Object.assign({}, s.clinic, { retentionDays: s.booking && s.booking.retentionDays });
  document.querySelectorAll("[data-bind]").forEach(function (n) { var v = data[n.getAttribute("data-bind")]; if (v) n.textContent = v; });
}).catch(function () {});
