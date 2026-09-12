/**
 * CineStream Page-Level Ad Shield
 * ─────────────────────────────────────────────────────────────────────────────
 * Blocks the full-page transparent overlay/iframe injection attack used by
 * video embed providers (VidSrc, etc.) to hijack ALL clicks on the page.
 *
 * Attack pattern:
 *   1. The embed iframe fires a postMessage or script that injects a
 *      transparent <a href="ad-url"> or <iframe src="ad-url"> covering
 *      100vw × 100vh with position:fixed and a very high z-index.
 *   2. The next click anywhere on the page hits the invisible overlay first
 *      and navigates the tab to the ad URL.
 *
 * Defence layers (in order of speed):
 *   A. window.open() → always null
 *   B. All <a target="_blank"> navigations are blocked unless user-initiated
 *      from our own known UI elements
 *   C. MutationObserver scans every newly added DOM node and removes:
 *        – any <iframe> not inside #player-modal
 *        – any element that is position:fixed/absolute, covers >40% of
 *          the viewport, and is NOT one of our whitelisted modals
 *   D. Periodic sweep (every 250 ms) catches anything that slipped through
 *   E. click-capture handler: if a click's target is not inside the app's
 *      known elements, the event is cancelled
 * ─────────────────────────────────────────────────────────────────────────────
 */

// IDs of our own full-screen overlays that must NOT be removed
const WHITELIST_IDS = new Set([
    'player-modal',
    'detail-modal',
    'settings-modal',
    'ad-shield-click-layer',
    'player-backdrop',
]);

// IDs / class-name fragments that belong to our UI
const OUR_UI_ROOTS = [
    'main-header',
    'main-view-container',
    'player-modal',
    'detail-modal',
    'settings-modal',
    'main-footer',
];

// ── A. Kill window.open ───────────────────────────────────────────────────────
window.open = () => null;

// ── B. Block all external link navigations ────────────────────────────────────
// Any <a href> that tries to open a new tab from outside our own UI is blocked.
document.addEventListener('click', (e) => {
    // Walk up the DOM to find the nearest anchor
    const anchor = e.composedPath().find(n => n.tagName === 'A');
    if (!anchor) return;

    const href = anchor.getAttribute('href') || '';
    // Only care about absolute URLs (ads always use http/https)
    if (!href.startsWith('http')) return;

    // If the anchor is inside one of our own UI roots, let it through
    const isOurs = OUR_UI_ROOTS.some(id => {
        const root = document.getElementById(id);
        return root && root.contains(anchor);
    });
    if (isOurs) return;

    // Anything else is an injected ad link — block it
    console.info('[AdShield] Blocked external link navigation to:', href);
    e.preventDefault();
    e.stopImmediatePropagation();
}, true); // capture phase — runs before any other listener

// ── C & D. Element removal logic ─────────────────────────────────────────────
function isOurElement(el) {
    // Is this element (or any ancestor) one of our known UI elements?
    return OUR_UI_ROOTS.some(id => {
        const root = document.getElementById(id);
        return root && (root === el || root.contains(el));
    }) || WHITELIST_IDS.has(el.id);
}

function coversViewport(el) {
    try {
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Consider it a "full page overlay" if it covers >40% of viewport in both axes
        return r.width > vw * 0.4 && r.height > vh * 0.4;
    } catch (_) {
        return false;
    }
}

function getComputedPos(el) {
    try { return window.getComputedStyle(el).position; } catch (_) { return ''; }
}

function getComputedZ(el) {
    try { return parseInt(window.getComputedStyle(el).zIndex, 10) || 0; } catch (_) { return 0; }
}

function sweepElement(el) {
    if (!el || el.nodeType !== 1) return;
    if (isOurElement(el)) return;

    const tag = el.tagName;

    // Remove any <iframe> that is NOT inside #player-modal
    if (tag === 'IFRAME') {
        const playerModal = document.getElementById('player-modal');
        if (!playerModal || !playerModal.contains(el)) {
            console.info('[AdShield] Removed rogue iframe:', el.src);
            el.remove();
            return;
        }
    }

    // Remove any <a> or <div>/<section> that acts as a full-page click overlay
    if (tag === 'A' || tag === 'DIV' || tag === 'SECTION' || tag === 'SPAN') {
        const pos = getComputedPos(el);
        if ((pos === 'fixed' || pos === 'absolute') && coversViewport(el)) {
            console.info('[AdShield] Removed full-page overlay:', tag, el.id, el.className);
            el.remove();
            return;
        }
    }

    // Remove anything with a suspiciously high z-index that isn't ours
    // (ad overlays routinely use z-index: 999999)
    const z = getComputedZ(el);
    if (z > 10000) {
        console.info('[AdShield] Removed high-z element:', tag, el.id, el.className, 'z:', z);
        el.remove();
        return;
    }
}

// ── C. MutationObserver — react instantly to DOM injections ──────────────────
const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
        for (const node of m.addedNodes) {
            sweepElement(node);
        }
    }
});

// Watch the entire document so we catch injections inside <head> too
observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
});

// ── D. Periodic sweep — belt-and-suspenders cleanup ──────────────────────────
setInterval(() => {
    // 1. All iframes not inside player modal
    document.querySelectorAll('iframe').forEach(f => {
        const pm = document.getElementById('player-modal');
        if (!pm || !pm.contains(f)) {
            console.info('[AdShield] Sweep removed iframe:', f.src);
            f.remove();
        }
    });

    // 2. Full-page fixed/absolute overlays
    document.querySelectorAll('body > *').forEach(el => {
        if (isOurElement(el)) return;
        const pos = getComputedPos(el);
        if ((pos === 'fixed' || pos === 'absolute') && coversViewport(el)) {
            console.info('[AdShield] Sweep removed overlay:', el.tagName, el.id);
            el.remove();
        }
    });

    // 3. Anything with z-index > 10000 outside our UI
    document.querySelectorAll('[style*="z-index"]').forEach(el => {
        if (isOurElement(el)) return;
        if (getComputedZ(el) > 10000) {
            console.info('[AdShield] Sweep removed high-z:', el.tagName);
            el.remove();
        }
    });
}, 250);

// ── E. Last-resort click guard ────────────────────────────────────────────────
// If a click's target isn't inside any of our known UI roots, swallow it.
// This catches the case where the overlay couldn't be removed in time.
document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target || target === document.body || target === document.documentElement) return;

    const insideOurUI = OUR_UI_ROOTS.some(id => {
        const root = document.getElementById(id);
        return root && root.contains(target);
    });

    if (!insideOurUI) {
        console.info('[AdShield] Blocked click on element outside app UI:', target.tagName, target.id);
        e.preventDefault();
        e.stopImmediatePropagation();
    }
}, true); // capture phase
