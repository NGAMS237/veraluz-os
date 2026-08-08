/* ══════════════════════════════════════════════════════════════════
   veraluz-core.js — v0.3.0
   Bibliothèque utilitaire partagée VERALUZ
   Plateforme : GitHub Pages — JavaScript vanilla, aucune dépendance externe.
   Expose : window.VeraluzCore

   Utilisation dans un module :
     var VC = window.VeraluzCore || {};
     var normalizeOrderStatus = VC.normalizeOrderStatus || function(s){ return s||'pending'; };
   ══════════════════════════════════════════════════════════════════ */

(function(global) {
  'use strict';

  /* ══════════════════════════════════════════
     1. fmt(n) — Formatage nombre sans devise
     fmt(150000) → "150 000"
  ══════════════════════════════════════════ */
  function fmt(n) {
    if (n === null || n === undefined || n === '') return '0';
    var num = Number(n);
    if (isNaN(num)) return '0';
    return num.toLocaleString('fr-FR');
  }

  /* ══════════════════════════════════════════
     2. fmtMoney(n) — Formatage montant FCFA
     fmtMoney(150000) → "150 000 FCFA"
  ══════════════════════════════════════════ */
  function fmtMoney(n) {
    return fmt(n) + ' FCFA';
  }

  /* ══════════════════════════════════════════
     3. esc(s) — Échappement HTML anti-XSS
     Neutralise : & < > " ' `
     Ne plante jamais sur null ou undefined.
  ══════════════════════════════════════════ */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#x27;')
      .replace(/`/g,  '&#x60;');
  }

  /* ══════════════════════════════════════════
     4. gid(prefix) — Identifiant unique simple
     gid('ord') → "ord_1x2y3z4_a8f2"
  ══════════════════════════════════════════ */
  function gid(prefix) {
    var ts   = Date.now().toString(36);
    var rand = Math.random().toString(36).slice(2, 6);
    var id   = ts + '_' + rand;
    return prefix ? (String(prefix) + '_' + id) : id;
  }

  /* ══════════════════════════════════════════
     5. fmtDate(value) — Date lisible
     Gère : ISO, timestamp, null, invalide
  ══════════════════════════════════════════ */
  function fmtDate(value) {
    if (!value && value !== 0) return '';
    var d = (value instanceof Date) ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  /* ══════════════════════════════════════════
     6. fmtDateTime(value) — Date + heure
  ══════════════════════════════════════════ */
  function fmtDateTime(value) {
    if (!value && value !== 0) return '';
    var d = (value instanceof Date) ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    }) + ' ' + d.toLocaleTimeString('fr-FR', {
      hour: '2-digit', minute: '2-digit'
    });
  }

  /* ══════════════════════════════════════════
     7. toast(message, type, duration)
     Types : success | error | warning | info
     Crée automatiquement le conteneur si absent.
     Style sobre compatible dark theme VERALUZ.
     Note : les modules existants ont leur propre
     toast lié à un élément DOM spécifique.
     VeraluzCore.toast est disponible pour le
     nouveau code qui n'a pas de DOM dédié.
  ══════════════════════════════════════════ */
  var _vcToastTimer = null;
  function toast(message, type, duration) {
    var containerId = 'vc-toast-container';
    var container   = document.getElementById(containerId);
    if (!container) {
      container             = document.createElement('div');
      container.id          = containerId;
      container.style.cssText = [
        'position:fixed', 'top:72px', 'left:50%',
        'transform:translateX(-50%)',
        'z-index:9999', 'pointer-events:none',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'gap:8px'
      ].join(';');
      document.body.appendChild(container);
    }

    var el     = document.createElement('div');
    var colors = {
      success: '#16a34a',
      error:   '#dc2626',
      warning: '#f59e0b',
      info:    '#3b82f6'
    };
    var bg = colors[String(type || '')] || '#1a1a18';

    el.style.cssText = [
      'background:' + bg,
      'color:#fff',
      'padding:9px 18px',
      'border-radius:50px',
      'font-family:Inter,sans-serif',
      'font-size:.77rem',
      'font-weight:600',
      'box-shadow:0 4px 16px rgba(0,0,0,.25)',
      'opacity:0',
      'transition:opacity .25s',
      'white-space:nowrap',
      'pointer-events:none',
      'max-width:340px',
      'text-align:center'
    ].join(';');
    el.textContent = String(message || '');
    container.appendChild(el);

    /* Fade in */
    requestAnimationFrame(function() {
      requestAnimationFrame(function() { el.style.opacity = '1'; });
    });

    /* Auto-dismiss */
    var dur = (typeof duration === 'number' && duration > 0) ? duration : 2800;
    setTimeout(function() {
      el.style.opacity = '0';
      setTimeout(function() {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 300);
    }, dur);
  }

  /* ══════════════════════════════════════════
     8. GET(url, options) — Wrapper fetch GET
     options : { headers, mode, credentials }
  ══════════════════════════════════════════ */
  function GET(url, options) {
    var opts = options || {};
    return fetch(url, {
      method:      'GET',
      mode:        opts.mode        || 'cors',
      credentials: opts.credentials || 'omit',
      headers:     Object.assign({ Accept: 'application/json' }, opts.headers || {})
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ══════════════════════════════════════════
     9. POST(url, data, options) — Wrapper fetch POST JSON
  ══════════════════════════════════════════ */
  function POST(url, data, options) {
    var opts = options || {};
    return fetch(url, {
      method:      'POST',
      mode:        opts.mode        || 'cors',
      credentials: opts.credentials || 'omit',
      headers:     Object.assign({
        'Content-Type': 'application/json',
        'Accept':       'application/json'
      }, opts.headers || {}),
      body: JSON.stringify(data)
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ══════════════════════════════════════════
     10. PATCH(url, data, options) — Wrapper fetch PATCH JSON
  ══════════════════════════════════════════ */
  function PATCH(url, data, options) {
    var opts = options || {};
    return fetch(url, {
      method:      'PATCH',
      mode:        opts.mode        || 'cors',
      credentials: opts.credentials || 'omit',
      headers:     Object.assign({
        'Content-Type': 'application/json',
        'Accept':       'application/json'
      }, opts.headers || {}),
      body: JSON.stringify(data)
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ══════════════════════════════════════════
     11. DELETE(url, options) — Wrapper fetch DELETE
  ══════════════════════════════════════════ */
  function DELETE(url, options) {
    var opts = options || {};
    return fetch(url, {
      method:      'DELETE',
      mode:        opts.mode        || 'cors',
      credentials: opts.credentials || 'omit',
      headers:     Object.assign({ Accept: 'application/json' }, opts.headers || {})
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      /* 204 No Content — retourne null */
      return r.status === 204 ? null : r.json().catch(function() { return null; });
    });
  }

  /* ══════════════════════════════════════════
     12. normalizeOrderStatus(status)
     Table canonique officielle — validée PROMPT 002B.

     IMPORTANT : paye / payé / paid sont des valeurs LEGACY.
     Elles sont mappées vers 'delivered' pour la LECTURE uniquement.
     Ne jamais écrire ces valeurs comme status opérationnel
     dans veraluz_food_orders.

     Statuts canoniques écrits :
       pending | confirmed | preparing | ready |
       out_for_delivery | delivered | cancelled
  ══════════════════════════════════════════ */
  function normalizeOrderStatus(status) {
    var map = {
      /* pending */
      'attente':          'pending',
      'pending':          'pending',
      /* confirmed — NE PAS mapper vers pending */
      'confirme':         'confirmed',
      'confirmé':    'confirmed',
      'confirmed':        'confirmed',
      /* preparing */
      'preparing':        'preparing',
      'preparation':      'preparing',
      'préparation': 'preparing',
      'en_preparation':   'preparing',
      /* ready */
      'pret':             'ready',
      'prêt':        'ready',
      'ready':            'ready',
      /* out_for_delivery — statut canonique (remplace "delivering") */
      'en_livraison':     'out_for_delivery',
      'out_for_delivery': 'out_for_delivery',
      'delivering':       'out_for_delivery',   /* legacy interne → canonique */
      /* delivered */
      'delivered':        'delivered',
      'livre':            'delivered',
      'livré':       'delivered',
      /* LEGACY READ ONLY — ne jamais écrire comme status opérationnel food */
      'recu':             'delivered',           /* reçu = livré */
      'paye':             'delivered',
      'payé':        'delivered',
      'paid':             'delivered',
      /* cancelled */
      'cancelled':        'cancelled',
      'annule':           'cancelled',
      'annulé':      'cancelled',
      'canceled':         'cancelled'
    };
    return map[String(status || '').toLowerCase()] || 'pending';
  }

  /* ══════════════════════════════════════════
     13. normalizeEmployee(row)
     Mappe toutes les variantes de colonnes employé
     vers un format standard unifié.
     Supporte :
       - veraluz_employees (full_name, role, hire_date, team FK)
       - veraluz_rh_employes legacy (prenom, nom, poste, equipe, actif)
     Retourne :
       { id, full_name, first_name, last_name,
         prenom, nom,           // aliases legacy
         role, poste,           // role (officiel) = poste (legacy)
         team_id, team_name,
         pin, pin_code,
         active, vehicule, phone, email, date_embauche,
         raw }                  // ligne originale non modifiée
  ══════════════════════════════════════════ */
  function normalizeEmployee(row) {
    if (!row) return null;

    /* full_name depuis toutes les variantes */
    var fullName = row.full_name || row.name || '';
    if (!fullName) {
      var fn = row.prenom || row.first_name || '';
      var ln = row.nom    || row.last_name  || '';
      fullName = (fn + ' ' + ln).trim();
    }
    var parts = fullName.trim().split(/\s+/);

    /* Équipe — support join Supabase (team: {id, name}) */
    var teamObj  = row.team || null;
    var teamId   = (teamObj && teamObj.id)   || row.team_id   || null;
    var teamName = (teamObj && teamObj.name)  || row.team_name || row.tname || '';

    /* Rôle */
    var role = row.role || row.poste || row.position || '';

    /* PIN — PROMPT 018: ne pas propager pin_code vers modules clients */

    /* Actif — supporte les deux conventions */
    var active = (row.status === 'actif') || (row.actif === true) || (row.active === true);

    return {
      id:            row.id,
      full_name:     fullName,
      first_name:    parts[0] || '',
      last_name:     parts.slice(1).join(' ') || '',
      /* Aliases de compatibilité legacy */
      prenom:        parts[0] || '',
      nom:           parts.slice(1).join(' ') || '',
      /* Rôle */
      role:          role,
      poste:         role,
      /* Équipe */
      team_id:       teamId,
      team_name:     teamName,
      /* PIN — supprimé PROMPT 018: ne jamais propager vers modules non-Auth */
      /* Autres */
      active:        active,
      vehicule:      row.vehicule      || '',
      phone:         row.phone         || '',
      email:         row.email         || '',
      date_embauche: row.hire_date     || row.date_embauche || '',
      /* Ligne originale non modifiée */
      raw: row
    };
  }

  /* ══════════════════════════════════════════
     14. isDeliveryEmployee(employee)
     Détecte un livreur par équipe OU rôle.
     Mots-clés : livr | delivery | livreur | driver | coursier
     Supporte les deux conventions de colonnes.
  ══════════════════════════════════════════ */
  function isDeliveryEmployee(emp) {
    if (!emp) return false;
    var team = String(
      (emp.team && emp.team.name) || emp.team_name || emp.tname || ''
    ).toLowerCase();
    var role = String(
      emp.role || emp.poste || emp.position || ''
    ).toLowerCase();
    return (
      team.includes('livr')     || team.includes('delivery') ||
      role.includes('livreur')  || role.includes('delivery') ||
      role.includes('driver')   || role.includes('coursier')
    );
  }

  /* ══════════════════════════════════════════
     Utilitaires additionnels
  ══════════════════════════════════════════ */

  /* safeJson(str) — Parse JSON sans exception */
  function safeJson(str) {
    try { return JSON.parse(str); } catch (e) { return null; }
  }

  /* log(level, ...args) — Log structuré préfixé */
  function log(level) {
    var args   = Array.prototype.slice.call(arguments, 1);
    var prefix = '[VERALUZ ' + String(level || 'INFO').toUpperCase() + ']';
    if (typeof console === 'undefined') return;
    try {
      if (level === 'error' && console.error) {
        console.error.apply(console, [prefix].concat(args));
      } else if (level === 'warn' && console.warn) {
        console.warn.apply(console, [prefix].concat(args));
      } else if (console.log) {
        console.log.apply(console, [prefix].concat(args));
      }
    } catch (e) { /* silent — console peut être restreint */ }
  }

  /* ══════════════════════════════════════════
     Export global window.VeraluzCore
  ══════════════════════════════════════════ */
  global.VeraluzCore = {
    version:              '0.3.0',
    /* Formatage */
    fmt:                  fmt,
    fmtMoney:             fmtMoney,
    esc:                  esc,
    gid:                  gid,
    fmtDate:              fmtDate,
    fmtDateTime:          fmtDateTime,
    /* UI */
    toast:                toast,
    /* HTTP */
    GET:                  GET,
    POST:                 POST,
    PATCH:                PATCH,
    DELETE:               DELETE,
    /* Normalize */
    normalizeOrderStatus: normalizeOrderStatus,
    normalizeEmployee:    normalizeEmployee,
    isDeliveryEmployee:   isDeliveryEmployee,
    /* Utilitaires */
    safeJson:             safeJson,
    log:                  log
  };

}(window));
