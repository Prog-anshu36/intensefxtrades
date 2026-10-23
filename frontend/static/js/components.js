/* components.js — shared formatters and small reusable render helpers */

const Fmt = {
  currencySymbol() {
    return Store?.state?.currency_symbol || "$";
  },
  money(v, opts = {}) {
    const sign = v > 0 ? "+" : v < 0 ? "" : "";
    const n = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${v < 0 ? "-" : sign}${this.currencySymbol()}${n}`;
  },
  moneyPlain(v) {
    return `${this.currencySymbol()}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },
  pct(v, digits = 1) {
    return `${v >= 0 ? "" : ""}${v.toFixed(digits)}%`;
  },
  price(v, decimals = 5) {
    return v.toFixed(decimals);
  },
  date(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    return dt.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", month: "short", day: "numeric" });
  },
  time(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    return dt.toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
  },
  dateTime(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    return `${this.date(dt)}, ${this.time(dt)}`;
  },
  cls(v) { return v >= 0 ? "up" : "down"; },
};

const SymbolUI = {
  colorFor(symbol) {
    const meta = MarketData.getMeta(symbol);
    return meta.color;
  },
  iconLetter(symbol) {
    return symbol.slice(0, 2);
  },
  iconHtml(symbol, size = 34) {
    const color = this.colorFor(symbol);
    return `<div class="pos-symbol-icon" style="background:${color};width:${size}px;height:${size}px;font-size:${size * 0.34}px">${this.iconLetter(symbol)}</div>`;
  },
};

/* Build a smooth SVG line/area chart from an array of numbers.
   Returns inner SVG markup (paths + optional gradient fill), caller supplies <svg> wrapper. */
function buildLineChart(values, { width = 760, height = 220, color = "#3d7fff", fill = true, padding = 10 } = {}) {
  if (!values || values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = (max - min) || 1;
  const stepX = (width - padding * 2) / (values.length - 1 || 1);

  const points = values.map((v, i) => {
    const x = padding + i * stepX;
    const y = padding + (height - padding * 2) * (1 - (v - min) / range);
    return [x, y];
  });

  let path = `M ${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const mx = (x0 + x1) / 2;
    path += ` Q ${x0},${y0} ${mx},${(y0 + y1) / 2}`;
  }
  path += ` L ${points[points.length - 1][0]},${points[points.length - 1][1]}`;

  const gradId = `grad_${Math.random().toString(36).slice(2, 9)}`;
  const last = points[points.length - 1];

  let areaPath = "";
  if (fill) {
    areaPath = `${path} L ${last[0]},${height - padding} L ${points[0][0]},${height - padding} Z`;
  }

  return `
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${fill ? `<path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>` : ""}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="${color}" class="chart-tooltip-dot"/>
  `;
}

function emptyState(title, sub, iconSvg, action) {
  // action: optional { label, onClick } — onClick receives no args; wire via data-empty-action and
  // a delegated listener since these strings are often injected via innerHTML.
  const actionId = action ? `empty-action-${Math.random().toString(36).slice(2, 8)}` : null;
  if (action && typeof action.onClick === "function") {
    // Defer binding until the element exists in the DOM.
    requestAnimationFrame(() => {
      const btn = document.getElementById(actionId);
      if (btn) btn.addEventListener("click", action.onClick);
    });
  }
  return `
    <div class="empty-state">
      <div class="empty-icon-wrap">
        ${iconSvg || `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 17l5-5 4 4 8-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`}
      </div>
      <h4>${title}</h4>
      <p>${sub}</p>
      ${action ? `<button class="empty-action" id="${actionId}">${action.label}</button>` : ""}
    </div>
  `;
}

function toast(message, kind = "info") {
  // User preference: button actions must not display pop-up notifications.
  return;
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.style.position = "fixed";
    host.style.bottom = "44px";
    host.style.right = "20px";
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.gap = "8px";
    host.style.zIndex = "9999";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  const colors = { info: "#3d7fff", success: "#1ec98b", error: "#f23645" };
  el.style.background = "#161a24";
  el.style.border = `1px solid ${colors[kind] || colors.info}`;
  el.style.color = "#e7e9ee";
  el.style.padding = "10px 14px";
  el.style.borderRadius = "10px";
  el.style.fontSize = "12.5px";
  el.style.fontFamily = "Inter, sans-serif";
  el.style.boxShadow = "0 8px 24px rgba(0,0,0,.4)";
  el.style.opacity = "0";
  el.style.transform = "translateY(8px)";
  el.style.transition = "opacity .2s ease, transform .2s ease";
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateY(0)"; });
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    setTimeout(() => el.remove(), 220);
  }, 2600);
}
