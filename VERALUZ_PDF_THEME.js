/**
 * VERALUZ_PDF_THEME — Système de design PDF centralisé
 * Version : 1.0 — 2026-08-08
 *
 * Usage :
 *   const pdf = new VeraluzPDF({ type: 'direction_report', title: 'Rapport Direction', ... });
 *   const htmlString = pdf.render([section1, section2]);
 *   window.print() — ou génération via lib (jsPDF, Puppeteer, etc.)
 */

'use strict';

/* ── Palette ──────────────────────────────────────────────────────────────── */
const VERALUZ_COLORS = {
  bleuNuit:   '#0D1B2A',
  bleuNuitMd: '#1A2E45',
  turquoise:  '#0ABFBC',
  or:         '#C9A84C',
  offWhite:   '#F8F7F4',
  blanc:      '#FFFFFF',
  gris1:      '#4A5568',
  gris2:      '#CBD5E0',
  rouge:      '#E53E3E',
  vert:       '#38A169',
};

/* ── Types de documents ───────────────────────────────────────────────────── */
const VERALUZ_DOC_TYPES = {
  direction_report:         { label: 'Rapport de Direction',       icon: '📊' },
  financial_report:         { label: 'Rapport Financier',          icon: '💰' },
  hr_report:                { label: 'Rapport RH',                 icon: '👥' },
  reservation_confirmation: { label: 'Confirmation de Réservation',icon: '🛎️' },
  payment_receipt:          { label: 'Reçu de Paiement',           icon: '🧾' },
  invoice:                  { label: 'Facture',                    icon: '📄' },
  payroll:                  { label: 'Bulletin de Paie',           icon: '💳' },
  maintenance_report:       { label: 'Rapport de Maintenance',     icon: '🔧' },
  security_report:          { label: 'Rapport de Sécurité',        icon: '🔒' },
  generic_report:           { label: 'Document',                   icon: '📋' },
};

/* ── CSS du thème ─────────────────────────────────────────────────────────── */
function veraluzPdfCss() {
  return `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }

body.vlz-pdf {
  font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
  background: #F8F7F4;
  color: #1A202C;
  font-size: 13px;
  line-height: 1.6;
}

/* Header */
.vlz-pdf-header {
  background: #0D1B2A;
  color: #FFFFFF;
  padding: 28px 40px 20px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 4px solid #0ABFBC;
}
.vlz-pdf-brand-name {
  font-size: 26px; font-weight: 800; letter-spacing: 2px;
  color: #0ABFBC;
}
.vlz-pdf-brand-sub {
  font-size: 11px; color: rgba(255,255,255,.6);
  letter-spacing: 1px; text-transform: uppercase; margin-top: 2px;
}
.vlz-pdf-doc-meta { text-align: right; font-size: 11px; color: rgba(255,255,255,.75); }
.vlz-pdf-doc-type {
  display: inline-block; font-size: 12px; font-weight: 600;
  background: rgba(10,191,188,.15); border: 1px solid #0ABFBC;
  color: #0ABFBC; padding: 2px 10px; border-radius: 20px; margin-bottom: 6px;
}
.vlz-pdf-ref { font-size: 10px; color: rgba(255,255,255,.5); margin-top: 4px; }

/* Simulation banner */
.vlz-pdf-sim-banner {
  background: rgba(245,158,11,.12);
  border: 1px solid rgba(245,158,11,.4);
  color: #92400E;
  text-align: center; padding: 8px 20px;
  font-size: 12px; font-weight: 600; letter-spacing: .5px;
}

/* Title block */
.vlz-pdf-title-block {
  background: #FFFFFF;
  padding: 24px 40px;
  border-bottom: 1px solid #CBD5E0;
}
.vlz-pdf-title { font-size: 22px; font-weight: 700; color: #0D1B2A; }
.vlz-pdf-subtitle { font-size: 13px; color: #4A5568; margin-top: 4px; }
.vlz-pdf-meta-row {
  display: flex; gap: 24px; margin-top: 12px;
  font-size: 11px; color: #4A5568; flex-wrap: wrap;
}
.vlz-pdf-meta-label { color: #CBD5E0; margin-right: 3px; }

/* Body */
.vlz-pdf-body { padding: 24px 40px; }

/* Section */
.vlz-pdf-section {
  background: #FFFFFF; border: 1px solid #CBD5E0;
  border-radius: 8px; margin-bottom: 20px; overflow: hidden;
  page-break-inside: avoid;
}
.vlz-pdf-section-header {
  background: #0D1B2A; color: #FFFFFF;
  padding: 10px 20px; font-size: 13px; font-weight: 600;
  display: flex; align-items: center; gap: 8px;
  border-bottom: 2px solid #0ABFBC;
}
.vlz-pdf-section-body { padding: 16px 20px; }

/* KPI Cards */
.vlz-pdf-kpis { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.vlz-pdf-kpi {
  flex: 1; min-width: 120px;
  background: #F8F7F4; border: 1px solid #CBD5E0;
  border-top: 3px solid #0ABFBC;
  border-radius: 6px; padding: 12px 16px;
}
.vlz-pdf-kpi.gold  { border-top-color: #C9A84C; }
.vlz-pdf-kpi.red   { border-top-color: #E53E3E; }
.vlz-pdf-kpi.green { border-top-color: #38A169; }
.vlz-pdf-kpi-label { font-size: 11px; color: #4A5568; text-transform: uppercase; letter-spacing: .5px; }
.vlz-pdf-kpi-value { font-size: 22px; font-weight: 700; color: #0D1B2A; margin: 4px 0 2px; }
.vlz-pdf-kpi-sub   { font-size: 11px; color: #4A5568; }

/* Table */
.vlz-pdf-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
.vlz-pdf-table th {
  background: #0D1B2A; color: #FFFFFF;
  padding: 8px 12px; text-align: left;
  font-weight: 600; font-size: 11px; letter-spacing: .4px;
}
.vlz-pdf-table td { padding: 8px 12px; border-bottom: 1px solid #CBD5E0; }
.vlz-pdf-table tr:nth-child(even) td { background: #F8F7F4; }
.vlz-pdf-table .accent { color: #0ABFBC; font-weight: 600; }
.vlz-pdf-table .gold   { color: #C9A84C; font-weight: 600; }

/* Text/notes */
.vlz-pdf-text { font-size: 13px; color: #2D3748; line-height: 1.7; }
.vlz-pdf-text p { margin-bottom: 8px; }
.vlz-pdf-note {
  background: rgba(10,191,188,.08);
  border-left: 3px solid #0ABFBC;
  padding: 10px 16px; border-radius: 0 6px 6px 0; margin: 12px 0; font-size: 12px;
}
.vlz-pdf-warn {
  background: rgba(229,62,62,.06);
  border-left: 3px solid #E53E3E;
  padding: 10px 16px; border-radius: 0 6px 6px 0; margin: 12px 0;
  font-size: 12px; color: #742A2A;
}

/* Sources */
.vlz-pdf-sources {
  font-size: 11px; color: #4A5568;
  margin-top: 16px; padding-top: 12px;
  border-top: 1px dashed #CBD5E0;
}

/* Footer */
.vlz-pdf-footer {
  background: #0D1B2A; color: rgba(255,255,255,.65);
  padding: 14px 40px;
  display: flex; justify-content: space-between; align-items: center;
  font-size: 11px; border-top: 2px solid #C9A84C;
  position: fixed; bottom: 0; left: 0; right: 0;
}
.vlz-pdf-footer-brand { font-weight: 700; color: #C9A84C; font-size: 12px; letter-spacing: 1px; }

/* Print */
@media print {
  .vlz-pdf-footer { position: fixed; bottom: 0; }
  .vlz-pdf-section { page-break-inside: avoid; }
  .vlz-pdf-header,
  .vlz-pdf-footer { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function vlzH(t) {
  return String(t == null ? '' : t)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function vlzFmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'
    });
  } catch(e) { return String(iso); }
}

/* ── Section renderer ────────────────────────────────────────────────────── */
function vlzRenderSection(s) {
  var html = '<div class="vlz-pdf-section">';
  html += '<div class="vlz-pdf-section-header"><span>'+(s.icon||'📋')+'</span><span>'+vlzH(s.title||'')+'</span></div>';
  html += '<div class="vlz-pdf-section-body">';

  // KPIs
  if (s.kpis && s.kpis.length) {
    html += '<div class="vlz-pdf-kpis">';
    s.kpis.forEach(function(k) {
      var cls = k.color ? ' '+k.color : '';
      html += '<div class="vlz-pdf-kpi'+cls+'">'
        + '<div class="vlz-pdf-kpi-label">'+vlzH(k.label)+'</div>'
        + '<div class="vlz-pdf-kpi-value">'+vlzH(k.value)+'</div>'
        + (k.sub ? '<div class="vlz-pdf-kpi-sub">'+vlzH(k.sub)+'</div>' : '')
        + '</div>';
    });
    html += '</div>';
  }

  // Table
  if (s.headers && s.rows) {
    html += '<table class="vlz-pdf-table"><thead><tr>';
    s.headers.forEach(function(h) { html += '<th>'+vlzH(h)+'</th>'; });
    html += '</tr></thead><tbody>';
    s.rows.forEach(function(row) {
      html += '<tr>';
      row.forEach(function(cell, i) {
        var cls = (s.cellClass && s.cellClass[i]) ? ' class="'+s.cellClass[i]+'"' : '';
        html += '<td'+cls+'>'+vlzH(cell == null ? '' : cell)+'</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
  }

  // Free text
  if (s.text) html += '<div class="vlz-pdf-text"><p>'+vlzH(s.text)+'</p></div>';
  if (s.note) html += '<div class="vlz-pdf-note">'+vlzH(s.note)+'</div>';
  if (s.warn) html += '<div class="vlz-pdf-warn">⚠ '+vlzH(s.warn)+'</div>';

  html += '</div></div>';
  return html;
}

/* ── Main renderer ───────────────────────────────────────────────────────── */
/**
 * veraluzPdfRender(opts, sections) → string HTML complet
 *
 * opts = {
 *   title, subtitle, document_type, generated_at, generated_by,
 *   reference, construction_mode, sources[], footer_note
 * }
 *
 * section = {
 *   title, icon, kpis[], headers[], rows[][], cellClass[],
 *   text, note, warn
 * }
 */
function veraluzPdfRender(opts, sections) {
  opts = Object.assign({
    title: 'Document VERALUZ',
    subtitle: '',
    document_type: 'generic_report',
    generated_at: new Date().toISOString(),
    generated_by: 'Système VERALUZ',
    reference: null,
    construction_mode: false,
    sources: [],
    footer_note: '',
  }, opts || {});

  var docType = VERALUZ_DOC_TYPES[opts.document_type] || VERALUZ_DOC_TYPES.generic_report;
  var pageDate = vlzFmtDate(opts.generated_at);
  var ref = opts.reference ? 'Réf. ' + opts.reference : '';

  var html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">'
    + '<title>'+vlzH(opts.title)+' — VERALUZ</title>'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>'+veraluzPdfCss()+'</style>'
    + '</head><body class="vlz-pdf">';

  // Header
  html += '<div class="vlz-pdf-header">'
    + '<div><div class="vlz-pdf-brand-name">VERALUZ</div>'
    + '<div class="vlz-pdf-brand-sub">Résidences Kribi · Cameroun</div></div>'
    + '<div class="vlz-pdf-doc-meta">'
    + '<div class="vlz-pdf-doc-type">'+docType.icon+' '+vlzH(docType.label)+'</div>'
    + '<div>'+vlzH(pageDate)+'</div>'
    + '<div>Par : '+vlzH(opts.generated_by)+'</div>'
    + (ref ? '<div class="vlz-pdf-ref">'+vlzH(ref)+'</div>' : '')
    + '</div></div>';

  // Simulation banner
  if (opts.construction_mode) {
    html += '<div class="vlz-pdf-sim-banner">⚙ SIMULATION CONSTRUCTION — Données réelles, fonctionnalités en déploiement</div>';
  }

  // Title block
  html += '<div class="vlz-pdf-title-block">'
    + '<div class="vlz-pdf-title">'+vlzH(opts.title)+'</div>'
    + (opts.subtitle ? '<div class="vlz-pdf-subtitle">'+vlzH(opts.subtitle)+'</div>' : '')
    + '<div class="vlz-pdf-meta-row">'
    + '<span><span class="vlz-pdf-meta-label">Généré le</span>'+vlzH(pageDate)+'</span>'
    + '<span><span class="vlz-pdf-meta-label">Par</span>'+vlzH(opts.generated_by)+'</span>'
    + (ref ? '<span><span class="vlz-pdf-meta-label">Réf.</span>'+vlzH(opts.reference)+'</span>' : '')
    + '</div></div>';

  // Body
  html += '<div class="vlz-pdf-body">';
  (sections || []).forEach(function(s) { html += vlzRenderSection(s); });

  // Sources
  if (opts.sources && opts.sources.length) {
    html += '<div class="vlz-pdf-sources">📌 Sources : '
      + opts.sources.map(function(s){ return vlzH(s); }).join(' · ')
      + '</div>';
  }
  html += '</div>';

  // Footer
  html += '<div class="vlz-pdf-footer">'
    + '<div class="vlz-pdf-footer-brand">VERALUZ</div>'
    + '<div>'+vlzH(opts.footer_note || 'Document confidentiel — Usage interne')+'</div>'
    + '<div>Imprimé le '+vlzH(pageDate)+'</div>'
    + '</div>';

  html += '</body></html>';
  return html;
}

/* ── Export ──────────────────────────────────────────────────────────────── */
if (typeof module !== 'undefined') {
  module.exports = { veraluzPdfRender, veraluzPdfCss, VERALUZ_COLORS, VERALUZ_DOC_TYPES };
}
if (typeof window !== 'undefined') {
  window.veraluzPdfRender  = veraluzPdfRender;
  window.veraluzPdfCss     = veraluzPdfCss;
  window.VERALUZ_COLORS    = VERALUZ_COLORS;
  window.VERALUZ_DOC_TYPES = VERALUZ_DOC_TYPES;
}
