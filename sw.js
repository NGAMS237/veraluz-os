/**
 * VERALUZ PWA — Service Worker
 * PROMPT 011 — Version 1.0
 *
 * Stratégie :
 *   - Cache-first  : assets statiques (icônes, manifests, veraluz-core.js)
 *   - Network-first: HTML (CORE, LIVREUR) pour toujours servir la version récente
 *   - No-cache     : tout appel Supabase REST, Edge Functions, données auth
 *
 * À chaque changement important des fichiers statiques, incrémenter CACHE_NAME.
 */

var CACHE_NAME = 'veraluz-pwa-v033-emergency'; /* EMERGENCY_001 */

// Contrôle d'activation (mettre false pour désactiver en dev si besoin)
var VERALUZ_PWA_ENABLED = true;

// Assets statiques à pré-cacher au moment de l'install
var STATIC_ASSETS = [
  './VERALUZ_OS_CORE.html',
  './LIVREUR.html',
  './veraluz-core.js',
  './manifest-os.webmanifest',
  './manifest-livreur.webmanifest',
  './FOOD_LOUNGE.html',
  './manifest-food.webmanifest',
  './assets/pwa/icon-192.png',
  './assets/pwa/icon-512.png',
  './assets/pwa/icon-maskable-192.png',
  './assets/pwa/icon-maskable-512.png',
  './assets/pwa/icon-livreur-192.png',
  './assets/pwa/icon-livreur-512.png',
  './assets/pwa/icon-maskable-livreur-192.png',
  './assets/pwa/icon-maskable-livreur-512.png'
];

// Page de fallback offline si le HTML n'est pas en cache
var OFFLINE_FALLBACK = './VERALUZ_OS_CORE.html';

/**
 * Retourne true si la requête NE DOIT PAS être mise en cache.
 * Sécurité : ne jamais cacher sessions, PIN, auth, Supabase REST, Edge Functions.
 */
function shouldBypassCache(url, request) {
  return (
    request.method !== 'GET' ||
    url.includes('/rest/v1/') ||
    url.includes('/functions/v1/') ||
    url.includes('supabase.co') ||
    url.includes('apikey') ||
    url.includes('Authorization') ||
    url.includes('auth/v1/') ||
    url.includes('realtime/v1/') ||
    url.includes('storage/v1/')
  );
}

/**
 * Retourne true pour les assets statiques à servir depuis le cache en priorité.
 */
function isStaticAsset(url) {
  return (
    url.endsWith('.png') ||
    url.endsWith('.jpg') ||
    url.endsWith('.ico') ||
    url.endsWith('.webmanifest') ||
    url.endsWith('.js') ||
    url.endsWith('.css') ||
    url.endsWith('.woff2') ||
    url.endsWith('.woff')
  );
}

// ── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  if (!VERALUZ_PWA_ENABLED) return;

  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // On ignore les erreurs individuelles (fichier absent = pas bloquant)
      return Promise.allSettled(
        STATIC_ASSETS.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('[VERALUZ SW] Impossible de cacher:', url, err.message);
          });
        })
      );
    }).then(function() {
      console.log('[VERALUZ SW] Installé —', CACHE_NAME);
      // Activation immédiate sans attendre la fermeture des onglets
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ───────────────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          // Supprimer tous les anciens caches VERALUZ (sauf le courant)
          return key.startsWith('veraluz-pwa-') && key !== CACHE_NAME;
        }).map(function(key) {
          console.log('[VERALUZ SW] Suppression ancien cache:', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      console.log('[VERALUZ SW] Activé —', CACHE_NAME);
      // Prendre contrôle de tous les onglets ouverts immédiatement
      return self.clients.claim();
    })
  );
});

// ── FETCH ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  if (!VERALUZ_PWA_ENABLED) return;

  var request = event.request;
  var url = request.url;

  // ── Bypass total pour Supabase, Edge Functions, données sensibles ────────
  if (shouldBypassCache(url, request)) {
    // Passer directement au réseau, ne rien écrire en cache
    event.respondWith(fetch(request));
    return;
  }

  // ── Assets statiques : Cache-First ──────────────────────────────────────
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(request).then(function(cached) {
          if (cached) {
            // Mettre à jour le cache en arrière-plan (stale-while-revalidate)
            fetch(request).then(function(response) {
              if (response && response.ok) {
                cache.put(request, response.clone());
              }
            }).catch(function(){});
            return cached;
          }
          // Pas en cache : aller chercher sur le réseau et mettre en cache
          return fetch(request).then(function(response) {
            if (response && response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          });
        });
      })
    );
    return;
  }

  // ── HTML (CORE, LIVREUR) : Network-First ────────────────────────────────
  if (url.endsWith('.html') || url.includes('VERALUZ_OS_CORE') || url.includes('LIVREUR')) {
    event.respondWith(
      fetch(request).then(function(response) {
        if (response && response.ok) {
          // Mettre à jour le cache avec la version réseau la plus récente
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(request, response.clone());
          });
        }
        return response;
      }).catch(function() {
        // Réseau indisponible → servir depuis le cache
        return caches.open(CACHE_NAME).then(function(cache) {
          return cache.match(request).then(function(cached) {
            if (cached) return cached;
            // Dernier recours : fallback page principale
            return cache.match(OFFLINE_FALLBACK);
          });
        });
      })
    );
    return;
  }

  // ── Toute autre requête GET : Network-First avec fallback cache ──────────
  event.respondWith(
    fetch(request).then(function(response) {
      return response;
    }).catch(function() {
      return caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(request);
      });
    })
  );
});
