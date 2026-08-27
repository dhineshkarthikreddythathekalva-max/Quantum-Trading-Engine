/* ═══════════════════════════════════════════════
   Quantum Trading Engine site — app.js
   Renders the attached source files VERBATIM
   (fetched directly from attached_assets, byte-for-byte)
   and wires the copy / download actions.
   ═══════════════════════════════════════════════ */

(function () {
  "use strict";

  // ── Toast ───────────────────────────────────────────
  const toastEl = document.getElementById("toast");
  let toastTimer = null;

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  // ── Load source files verbatim ─────────────────────
  const codeBlocks = Array.from(document.querySelectorAll("pre.code[data-src]"));

  async function loadCodeBlock(block) {
    const src = block.getAttribute("data-src");
    if (!src) return;
    try {
      const res = await fetch(src, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      block.textContent = text;
      block.setAttribute("data-loaded", "1");
    } catch (err) {
      block.innerHTML =
        '<span class="code-error">Could not load source (' +
        String(err && err.message ? err.message : err) +
        "). Open the file directly: " +
        "</span>";
      const link = document.createElement("a");
      link.href = src;
      link.target = "_blank";
      link.textContent = src;
      block.appendChild(link);
    }
  }

  codeBlocks.forEach(loadCodeBlock);

  // ── Copy buttons ────────────────────────────────────
  function getSourceText(key) {
    const block = document.getElementById("code-" + key);
    if (block) {
      const loaded = block.getAttribute("data-loaded");
      if (loaded === "1") return block.textContent;
    }
    return null;
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    // Fallback for non-secure contexts / older browsers
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      const key = btn.getAttribute("data-copy");
      const text = getSourceText(key);
      if (text === null) {
        showToast("Source not loaded yet — try again in a moment");
        return;
      }
      try {
        await copyText(text);
        const name =
          key === "indicator"
            ? "Advanced Confluence System [v2]"
            : "Flask webhook + dashboard";
        showToast("Copied " + name + " — " + text.length + " chars");
      } catch (err) {
        showToast("Copy failed — please copy manually");
      }
    });
  });

  // ── Footer year (minor, no content changes) ─────────
  const yearEl = document.querySelector("[data-year]");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();
