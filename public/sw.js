/*
 * MAD DELIVERY HQ — Web Push service worker (WS-6.1).
 *
 * The whole point of this file is the rider (and the customer) whose phone is
 * LOCKED: nothing else in the app can reach them there. It is deliberately tiny
 * and dependency-free — it ships to prepaid 3G/4G handsets, is fetched on every
 * update check, and does no caching or offline work at all.
 *
 * The payload is built by lib/services/push.ts and is intentionally minimal:
 *   { title, body?, url?, tag }
 * `body` and `url` are omitted when they would be empty / "/", so the defaults
 * below have to match that contract.
 *
 * Written in conservative, pre-2020 JavaScript (no optional chaining, no `??`,
 * no template literals) so it also runs on the older Android Chrome / WebView
 * builds still common in Bangladesh. It is served straight from public/ and is
 * never transpiled or bundled, so what is written here is what ships.
 */

/** Fallbacks used when a field is omitted from the payload to save bytes. */
var DEFAULT_TITLE = "MAD DELIVERY HQ";
var DEFAULT_URL = "/";
var ICON = "/images/brand/mad-logo.webp";

// Take over as soon as a new version is fetched — a rider must never be left on
// a stale worker that mishandles an alert.
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  var payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A malformed / unencrypted push still has to raise SOMETHING: the browser
    // revokes the push permission of a worker that receives a push and shows no
    // notification (the `userVisibleOnly` contract). Falling through with an
    // empty payload produces the generic branded alert below.
    payload = {};
  }

  var url = safePath(payload.url);
  var options = {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: ICON,
    badge: ICON,
    // Group updates about the same order so a burst replaces itself on the lock
    // screen instead of stacking; `renotify` still buzzes for the new one.
    tag: typeof payload.tag === "string" && payload.tag ? payload.tag : url,
    renotify: true,
    vibrate: [120, 60, 120],
    data: { url: url },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(
        typeof payload.title === "string" && payload.title ? payload.title : DEFAULT_TITLE,
        options
      ),
      // Wake any tab that is already open so it can refresh immediately — this
      // is what lets the rider assignment gate poll slowly and still react fast.
      broadcast(url),
    ])
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var url = safePath(data.url);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
      // Prefer an already-open tab: opening a second one loses the rider's place
      // and costs another cold start on a slow connection.
      for (var i = 0; i < windows.length; i++) {
        var client = windows[i];
        if (!("focus" in client)) continue;
        if ("navigate" in client && new URL(client.url).pathname !== url) {
          return client.navigate(url).then(function (navigated) {
            return (navigated || client).focus();
          });
        }
        return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

/**
 * Accept only same-origin app PATHS. The link comes from a database row, so this
 * is the boundary that keeps a notification from being turned into an off-site
 * or cross-origin jump.
 */
function safePath(value) {
  if (typeof value !== "string") return DEFAULT_URL;
  if (value.charAt(0) !== "/" || value.charAt(1) === "/") return DEFAULT_URL;
  return value;
}

/** Tell every open tab a push arrived, so it can re-fetch what it shows. */
function broadcast(url) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
    for (var i = 0; i < windows.length; i++) {
      windows[i].postMessage({ source: "mad-push", url: url });
    }
  });
}
