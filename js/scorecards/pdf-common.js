// =====================================================================
// PDF COMMON
// jsPDF (loaded on first use - only the Download PDF button needs it) and
// basic drawing helpers for the scorecard report.
// =====================================================================

import { hexToRgbArray } from "./format.js";

const JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
let jsPdfPromise = null;

export function loadJsPdf() {
  if (!jsPdfPromise) {
    jsPdfPromise = new Promise((resolve, reject) => {
      // jsPDF's UMD wrapper registers with an AMD loader if it finds one
      // instead of setting window.jspdf - hide `define` while it loads.
      const savedDefine = window.define;
      window.define = undefined;
      const script = document.createElement("script");
      script.src = JSPDF_URL;
      script.onload = () => {
        window.define = savedDefine;
        resolve(window.jspdf.jsPDF);
      };
      script.onerror = () => {
        window.define = savedDefine;
        jsPdfPromise = null;
        reject(new Error("jsPDF failed to load"));
      };
      document.head.append(script);
    });
  }
  return jsPdfPromise;
}

export function rgb(hex) {
  return hexToRgbArray(hex).slice(0, 3);
}

export function rect(doc, x, y, w, h, fillHex, { radius = 0, borderHex } = {}) {
  doc.setFillColor(...rgb(fillHex));
  const style = borderHex ? "FD" : "F";
  if (borderHex) {
    doc.setDrawColor(...rgb(borderHex));
    doc.setLineWidth(0.2);
  }
  if (radius) doc.roundedRect(x, y, w, h, radius, radius, style);
  else doc.rect(x, y, w, h, style);
}

export function text(doc, value, x, y, { fontSize = 10, bold, italic, color = "#141414", align, spaced } = {}) {
  doc.setFont("helvetica", bold ? "bold" : italic ? "italic" : "normal");
  doc.setFontSize(fontSize);
  doc.setTextColor(...rgb(color));
  const options = {};
  if (align) options.align = align;
  if (spaced) options.charSpace = fontSize * 0.3528 * 0.08; // ~0.08em letter spacing
  doc.text(value, x, y, options);
}

export function safeFileName(name, suffix) {
  return `${name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "waterbody"}_${suffix}.pdf`;
}
