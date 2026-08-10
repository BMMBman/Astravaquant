document.documentElement.classList.add("js");

(function () {
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealNodes = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  var chartNodes = Array.prototype.slice.call(document.querySelectorAll("[data-points]"));
  var dialNodes = Array.prototype.slice.call(document.querySelectorAll("[data-dial-value]"));
  var tabGroups = Array.prototype.slice.call(document.querySelectorAll("[data-tabs]"));
  var yearNodes = Array.prototype.slice.call(document.querySelectorAll("[data-year]"));

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatSigned(value) {
    var safeValue = Math.abs(value).toFixed(2);
    if (value > 0) {
      return "+" + safeValue;
    }

    if (value < 0) {
      return "-" + safeValue;
    }

    return "0.00";
  }

  function pointOnDial(cx, cy, radius, angle) {
    var radians = (angle * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(radians),
      y: cy - radius * Math.sin(radians)
    };
  }

  function dialAngle(value) {
    return (1 - value) * 90;
  }

  function dialPath(cx, cy, radius, startAngle, endAngle) {
    var steps = Math.max(10, Math.ceil(Math.abs(endAngle - startAngle) / 4));
    var segments = [];

    for (var step = 0; step <= steps; step += 1) {
      var progress = step / steps;
      var angle = startAngle + (endAngle - startAngle) * progress;
      var point = pointOnDial(cx, cy, radius, angle);
      segments.push((step === 0 ? "M" : "L") + point.x.toFixed(2) + " " + point.y.toFixed(2));
    }

    return segments.join(" ");
  }

  function toneColor(tone) {
    if (tone === "bad") {
      return "#d37c71";
    }

    if (tone === "good") {
      return "#8caed3";
    }

    if (tone === "neutral") {
      return "#b9b5ae";
    }

    return "#c9a56a";
  }

  function animateDialValue(node, target) {
    if (!node) {
      return;
    }

    if (reduceMotion) {
      node.textContent = formatSigned(target);
      return;
    }

    var startTime = null;
    var duration = 950;

    function step(timestamp) {
      if (startTime === null) {
        startTime = timestamp;
      }

      var progress = Math.min((timestamp - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = formatSigned(target * eased);

      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        node.textContent = formatSigned(target);
      }
    }

    window.requestAnimationFrame(step);
  }

  function renderDial(node, index, animate) {
    var svg = node.querySelector(".dial-svg");
    var valueNode = node.querySelector(".dial-center strong");

    if (!svg) {
      return;
    }

    var value = parseFloat(node.getAttribute("data-dial-value"));
    var safeValue = clamp(isNaN(value) ? 0 : value, -1, 1);
    var tone = node.getAttribute("data-dial-tone") || "good";
    var color = toneColor(tone);
    var cx = 180;
    var cy = 164;
    var radius = 118;
    var neutralAngle = dialAngle(0);
    var currentAngle = dialAngle(safeValue);
    var marker = pointOnDial(cx, cy, radius, currentAngle);
    var activePath = dialPath(cx, cy, radius, neutralAngle, currentAngle);
    var zoneValues = [
      { start: -1, end: -0.75, color: "#b86b61" },
      { start: -0.75, end: -0.25, color: "#9f7552" },
      { start: -0.25, end: 0.25, color: "#6e747c" },
      { start: 0.25, end: 0.75, color: "#7c95af" },
      { start: 0.75, end: 1, color: "#98b7d8" }
    ];
    var zoneMarkup = zoneValues
      .map(function (zone) {
        return (
          '<path class="dial-zone" d="' +
          dialPath(cx, cy, radius, dialAngle(zone.start), dialAngle(zone.end)) +
          '" stroke="' +
          zone.color +
          '" />'
        );
      })
      .join("");

    node.style.setProperty("--dial-color", color);

    svg.innerHTML =
      '<path class="dial-track" d="' +
      dialPath(cx, cy, radius, 180, 0) +
      '" />' +
      zoneMarkup +
      '<path class="dial-active" d="' +
      activePath +
      '" stroke="' +
      color +
      '" />' +
      '<circle class="dial-dot" cx="' +
      marker.x.toFixed(2) +
      '" cy="' +
      marker.y.toFixed(2) +
      '" r="8" />';

    var active = svg.querySelector(".dial-active");
    var dot = svg.querySelector(".dial-dot");

    if (active) {
      var length = active.getTotalLength();
      active.style.strokeDasharray = String(length);
      active.style.strokeDashoffset = !animate || reduceMotion ? "0" : String(length);

      if (animate && !reduceMotion) {
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            active.style.strokeDashoffset = "0";
          });
        });
      }
    }

    if (dot) {
      if (!animate || reduceMotion) {
        dot.style.opacity = "1";
        dot.style.transform = "scale(1)";
      } else {
        window.setTimeout(function () {
          dot.style.opacity = "1";
          dot.style.transform = "scale(1)";
        }, 220 + index * 40);
      }
    }

    if (animate) {
      animateDialValue(valueNode, safeValue);
    } else if (valueNode) {
      valueNode.textContent = formatSigned(safeValue);
    }
  }

  function animateActiveDials(context) {
    Array.prototype.slice.call(context.querySelectorAll(".tab-panel.is-active [data-dial-value]")).forEach(function (node) {
      renderDial(node, parseInt(node.getAttribute("data-dial-index"), 10) || 0, true);
    });
  }

  function activateTab(group, targetId) {
    var buttons = Array.prototype.slice.call(group.querySelectorAll("[data-tab-target]"));
    var panels = Array.prototype.slice.call(group.querySelectorAll("[data-tab-panel]"));

    buttons.forEach(function (button) {
      var isActive = button.getAttribute("data-tab-target") === targetId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    panels.forEach(function (panel) {
      var isActive = panel.id === targetId;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });

    animateActiveDials(group);
  }

  function renderChart(svg) {
    var points = (svg.getAttribute("data-points") || "")
      .split(",")
      .map(function (value) {
        return parseFloat(value.trim());
      })
      .filter(function (value) {
        return !isNaN(value);
      });

    if (points.length < 2) {
      return;
    }

    var width = parseFloat(svg.getAttribute("viewBox").split(" ")[2]) || 240;
    var height = parseFloat(svg.getAttribute("viewBox").split(" ")[3]) || 84;
    var padding = 12;
    var min = Math.min.apply(null, points);
    var max = Math.max.apply(null, points);
    var range = max - min || 1;
    var tone = svg.getAttribute("data-tone") || "accent";
    var stroke = "#8fe0ff";
    var fill = "rgba(104, 182, 255, 0.18)";

    if (tone === "good") {
      stroke = "#7be4b1";
      fill = "rgba(123, 228, 177, 0.18)";
    } else if (tone === "warn") {
      stroke = "#f3c671";
      fill = "rgba(243, 198, 113, 0.16)";
    } else if (tone === "bad") {
      stroke = "#ff8f82";
      fill = "rgba(255, 143, 130, 0.18)";
    }

    var coords = points.map(function (point, index) {
      var x = padding + (index / (points.length - 1)) * (width - padding * 2);
      var y = height - padding - ((point - min) / range) * (height - padding * 2);
      return [x, y];
    });

    var line = coords
      .map(function (pair, index) {
        return (index === 0 ? "M" : "L") + pair[0].toFixed(2) + " " + pair[1].toFixed(2);
      })
      .join(" ");

    var area =
      line +
      " L" +
      coords[coords.length - 1][0].toFixed(2) +
      " " +
      (height - padding / 2).toFixed(2) +
      " L" +
      coords[0][0].toFixed(2) +
      " " +
      (height - padding / 2).toFixed(2) +
      " Z";

    svg.innerHTML =
      '<defs><linearGradient id="' +
      svg.dataset.chartId +
      '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' +
      fill.replace("0.18", "0.32").replace("0.16", "0.26") +
      '" /><stop offset="100%" stop-color="rgba(0,0,0,0)" /></linearGradient></defs>' +
      '<path d="' +
      area +
      '" fill="url(#' +
      svg.dataset.chartId +
      ')" />' +
      '<path d="' +
      line +
      '" fill="none" stroke="' +
      stroke +
      '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />' +
      '<path d="M12 ' +
      (height - 14) +
      " H" +
      (width - 12) +
      '" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="4 6" />';
  }

  chartNodes.forEach(function (node, index) {
    node.dataset.chartId = "chartGradient" + index;
    renderChart(node);
  });

  dialNodes.forEach(function (node, index) {
    node.setAttribute("data-dial-index", String(index));
    renderDial(node, index, false);
  });

  dialNodes
    .filter(function (node) {
      return !node.closest("[data-tab-panel]");
    })
    .forEach(function (node) {
      renderDial(node, parseInt(node.getAttribute("data-dial-index"), 10) || 0, true);
    });

  tabGroups.forEach(function (group) {
    var buttons = Array.prototype.slice.call(group.querySelectorAll("[data-tab-target]"));

    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        activateTab(group, button.getAttribute("data-tab-target"));
      });
    });

    animateActiveDials(group);
  });

  yearNodes.forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });

  if (revealNodes.length && !reduceMotion && "IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.18,
        rootMargin: "0px 0px -50px 0px"
      }
    );

    revealNodes.forEach(function (node) {
      observer.observe(node);
    });
  } else {
    revealNodes.forEach(function (node) {
      node.classList.add("is-visible");
    });
  }
})();
