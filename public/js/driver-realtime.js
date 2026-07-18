/**
 * driver-realtime.js — Real-time ride request updates
 *
 * Polls /driver/bookings/available every 3 seconds and immediately removes
 * ride cards from the DOM that were reserved by another driver.
 *
 * Also shows a discrete toast notification when rides are snatched.
 */
(function () {
  'use strict';

  var POLL_INTERVAL   = 3000;   // 3 seconds
  var FADE_DURATION   = 400;    // ms for card removal animation
  var TOAST_DURATION  = 5000;   // ms before toast auto-dismisses
  var pollTimer       = null;
  var statusCheckTimer = null;
  var previousIds     = new Set();
  var isOnline        = false;

  // ── Determine online status from the toggle button ──
  function getOnlineStatus() {
    var btn = document.getElementById('availToggle');
    if (!btn) return false;
    return btn.getAttribute('data-online') === 'true';
  }

  // ── Ensure a toast container exists in the DOM ──
  function ensureToastContainer() {
    if (document.getElementById('ride-toast-container')) return;
    var c = document.createElement('div');
    c.id = 'ride-toast-container';
    c.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:9999;' +
      'display:flex;flex-direction:column;gap:8px;' +
      'max-width:380px;pointer-events:none;';
    document.body.appendChild(c);
  }

  // ── Show a toast announcing removed rides ──
  function showToast(count) {
    var container = document.getElementById('ride-toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'ride-snatched-toast';
    toast.style.cssText =
      'pointer-events:auto;background:#1a1a2e;color:white;' +
      'padding:12px 16px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.25);' +
      'display:flex;align-items:center;gap:10px;' +
      'animation:toastSlideIn .3s ease;' +
      'font-size:.82rem;border-left:4px solid #e53e3e;';

    var icon = document.createElement('i');
    icon.className = 'ti ti-hand-off';
    icon.style.cssText = 'font-size:1.1rem;color:#ef5350;flex-shrink:0;';
    toast.appendChild(icon);

    var body = document.createElement('div');
    body.style.cssText = 'flex:1;min-width:0;';
    var strong = document.createElement('strong');
    strong.style.cssText = 'display:block;font-size:.78rem;margin-bottom:2px;';
    strong.textContent = count === 1
      ? 'Ride reserved by another driver'
      : count + ' rides reserved by other drivers';
    body.appendChild(strong);
    var p = document.createElement('p');
    p.style.cssText = 'font-size:.7rem;color:#aaa;margin:0;';
    p.textContent = 'The ride card has been removed from your dashboard.';
    body.appendChild(p);
    toast.appendChild(body);

    container.appendChild(toast);

    setTimeout(function () {
      toast.style.transition = 'opacity .3s ease,transform .3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(40px)';
      setTimeout(function () { if (toast.parentNode) toast.remove(); }, 300);
    }, TOAST_DURATION);
  }

  // ── Collect currently displayed ride-card IDs ──
  function getCurrentRideIds() {
    var ids = new Set();
    // Each ride card in the "Available" section has a form posting to /reserve/:id
    var forms = document.querySelectorAll(
      '.ride-card form[action*="/driver/bookings/reserve/"]'
    );
    forms.forEach(function (f) {
      var m = f.action.match(/\/reserve\/([a-f0-9]{24})/i);
      if (m) ids.add(m[1]);
    });
    return ids;
  }

  // ── Remove a ride card by its booking ID with animation ──
  function removeRideCard(bookingId) {
    var forms = document.querySelectorAll(
      '.ride-card form[action*="/driver/bookings/reserve/' + bookingId + '"]'
    );
    if (!forms.length) return false;
    var card = forms[0].closest('.ride-card');
    if (!card) return false;

    // Animate out
    card.style.transition =
      'opacity ' + FADE_DURATION + 'ms ease, ' +
      'transform ' + FADE_DURATION + 'ms ease, ' +
      'max-height ' + FADE_DURATION + 'ms ease';
    card.style.overflow = 'hidden';
    card.style.opacity = '0';
    card.style.transform = 'translateX(30px) scale(0.96)';
    card.style.maxHeight = card.offsetHeight + 'px';

    setTimeout(function () {
      card.style.maxHeight = '0';
      card.style.marginBottom = '0';
      card.style.paddingBottom = '0';
      card.style.paddingTop = '0';
      card.style.border = 'none';
    }, FADE_DURATION / 2);

    // Remove from DOM after animation completes
    setTimeout(function () {
      if (card.parentNode) card.remove();
      updateEmptyState();
      updateCountPill();
    }, FADE_DURATION + 200);

    return true;
  }

  // ── Show/hide the empty state when all cards are gone ──
  function updateEmptyState() {
    var grid = document.querySelector('.card .ride-grid');
    if (!grid) return;
    var cardEl = grid.closest('.card');
    if (!cardEl) return;

    var remaining = grid.querySelectorAll('.ride-card').length;
    var emptyEl  = cardEl.querySelector('.empty-state');
    var offline  = cardEl.querySelector('.offline-banner');

    if (remaining === 0 && !offline) {
      grid.style.display = 'none';
      if (!emptyEl) {
        var empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML =
          '<i class="ti ti-bell-off"></i>' +
          '<h4>No ride requests available</h4>' +
          '<p>All pending requests have been reserved. Check again soon or view all at Cab Bookings.</p>';
        // Insert after the card-head, before the ride-grid area
        var head = cardEl.querySelector('.card-head');
        if (head) head.after(empty);
        else cardEl.appendChild(empty);
      }
    } else {
      grid.style.display = '';
      if (emptyEl) emptyEl.remove();
    }
  }

  // ── Update the count pill in the available-requests card header ──
  function updateCountPill() {
    var grid = document.querySelector('.card .ride-grid');
    if (!grid) return;
    var cardEl = grid.closest('.card');
    if (!cardEl) return;
    var pill = cardEl.querySelector('.card-head .count-pill');
    if (!pill) return;
    var remaining = grid.querySelectorAll('.ride-card').length;
    pill.textContent = remaining + ' request' + (remaining !== 1 ? 's' : '');
  }

  // ── Poll the available-requests endpoint ──
  function pollAvailableRequests() {
    fetch('/driver/bookings/available')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        // If the driver is offline, stop polling
        if (data.offline) {
          stopPolling();
          return;
        }

        var newIds = new Set((data.requests || []).map(function (r) { return r._id; }));

        // Find IDs that we showed before but are no longer available
        var removedIds = [];
        previousIds.forEach(function (id) {
          if (!newIds.has(id)) removedIds.push(id);
        });

        if (removedIds.length > 0) {
          var actuallyRemoved = 0;
          removedIds.forEach(function (id) {
            if (removeRideCard(id)) actuallyRemoved++;
          });
          if (actuallyRemoved > 0) showToast(actuallyRemoved);
        }

        previousIds = newIds;
      })
      .catch(function (err) {
        // Silently ignore network hiccups
        if (err.name !== 'AbortError') {
          console.warn('[Driver Realtime] Poll error:', err);
        }
      });
  }

  // ── Start / stop polling ──
  function startPolling() {
    if (pollTimer) return;
    previousIds = getCurrentRideIds();
    pollTimer = setInterval(pollAvailableRequests, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    previousIds = new Set();
  }

  // ── Watch the availability toggle element for attribute changes ──
  function watchToggle() {
    var btn = document.getElementById('availToggle');
    if (!btn) return;

    // Re-check online status periodically
    if (statusCheckTimer) clearInterval(statusCheckTimer);
    statusCheckTimer = setInterval(function () {
      var online = getOnlineStatus();
      if (online !== isOnline) {
        isOnline = online;
        if (isOnline) startPolling();
        else stopPolling();
      }
    }, POLL_INTERVAL);
  }

  // ── Initialise ──
  function init() {
    // Only run on pages with a ride grid (available requests section)
    if (!document.querySelector('.card .ride-grid')) return;

    ensureToastContainer();

    isOnline = getOnlineStatus();
    if (isOnline) startPolling();

    watchToggle();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Cleanup on page unload ──
  window.addEventListener('beforeunload', function () {
    stopPolling();
    if (statusCheckTimer) clearInterval(statusCheckTimer);
  });
})();
