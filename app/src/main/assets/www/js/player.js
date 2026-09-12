/**
 * CineStream Video Player Module
 * Cleaner embed sources + aggressive popup/ad blocker + TV remote support
 */

import { Storage } from './storage.js';
import { API } from './api.js';

// ─── Popup / Ad Blocker ──────────────────────────────────────────────────────
// Override window.open so that ANY popup from the page or its iframes is killed
(function installPopupKiller() {
    // Block window.open globally
    const _origOpen = window.open.bind(window);
    window.open = function(url, target, features) {
        // Allow only same-origin or empty calls (e.g., print dialog)
        if (!url || url === 'about:blank') return _origOpen(url, target, features);
        console.info('[AdBlocker] Killed popup:', url);
        return null;
    };

    // Observer to nuke any DOM elements injected outside the player container
    // (some ads inject divs/iframes at top level)
    const adPatterns = [
        /doubleclick/i, /googlesyndication/i, /adnxs/i, /adsrvr/i,
        /popads/i, /popcash/i, /trafficjunky/i, /exoclick/i,
        /adsterra/i, /hilltopads/i, /propellerads/i, /ad\.js/i,
        /ads\.js/i, /banner/i
    ];

    function isAdElement(el) {
        const src = el.src || el.href || el.action || '';
        const id  = el.id  || '';
        const cls = el.className || '';
        return adPatterns.some(p => p.test(src) || p.test(id) || p.test(cls));
    }

    const bodyObserver = new MutationObserver((mutations) => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return; // element nodes only
                // Kill ad iframes / scripts injected into <body>
                if ((node.tagName === 'IFRAME' || node.tagName === 'SCRIPT') && isAdElement(node)) {
                    console.info('[AdBlocker] Removed injected ad element:', node.src);
                    node.remove();
                    return;
                }
                // Kill overlay divs with very high z-index (ad popover pattern)
                if (node.tagName === 'DIV' || node.tagName === 'A') {
                    const style = window.getComputedStyle(node);
                    const z = parseInt(style.zIndex, 10);
                    if (z > 9000 && style.position === 'fixed' && isAdElement(node)) {
                        console.info('[AdBlocker] Removed high-z ad overlay');
                        node.remove();
                    }
                }
            });
        });
    });
    bodyObserver.observe(document.body, { childList: true, subtree: false });
})();

// ─── Server Definitions ──────────────────────────────────────────────────────
// Servers ordered by cleanliness (fewest ads first)
export const SERVERS = [
    {
        id: 'vidsrcto',
        name: 'VidSrc.to',
        badge: 'Recommended',
        hasSubs: true,
        getMovieUrl: (id) => `https://vidsrc.to/embed/movie/${id}`,
        getTvUrl:    (id, s, e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}`
    },
    {
        id: 'autoembed',
        name: 'AutoEmbed (Clean)',
        badge: 'Clean',
        hasSubs: true,
        getMovieUrl: (id) => `https://autoembed.cc/movie/tmdb/${id}`,
        getTvUrl:    (id, s, e) => `https://autoembed.cc/tv/tmdb/${id}-${s}-${e}`
    },
    {
        id: 'vidsrcxyz',
        name: 'VidSrc.xyz',
        badge: 'Clean',
        hasSubs: true,
        getMovieUrl: (id) => `https://vidsrc.xyz/embed/movie/${id}`,
        getTvUrl:    (id, s, e) => `https://vidsrc.xyz/embed/tv/${id}/${s}/${e}`
    },
    {
        id: 'embed3',
        name: 'embed3.me',
        badge: 'Fast',
        hasSubs: true,
        getMovieUrl: (id) => `https://www.embed3.me/embed/movie/${id}`,
        getTvUrl:    (id, s, e) => `https://www.embed3.me/embed/tv/${id}/${s}/${e}`
    },
    {
        id: 'multiembed',
        name: 'MultiEmbed',
        badge: 'Multi',
        hasSubs: true,
        getMovieUrl: (id) => `https://multiembed.mov/?video_id=${id}&tmdb=1`,
        getTvUrl:    (id, s, e) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`
    },
    {
        id: 'embed2',
        name: '2Embed',
        badge: 'HD',
        hasSubs: true,
        getMovieUrl: (id) => `https://www.2embed.cc/embed/${id}`,
        getTvUrl:    (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`
    }
];


// ─── Player Class ────────────────────────────────────────────────────────────
export class Player {
    constructor(containerId) {
        this.container      = document.getElementById(containerId);
        this.currentMedia   = null;
        this.currentServer  = SERVERS[0];
        this.currentSeason  = 1;
        this.currentEpisode = 1;
        this.tvData         = null;
        this._overlayTimer  = null;
    }

    async open(media, season = 1, episode = 1) {
        this.currentMedia   = media;
        this.currentSeason  = season;
        this.currentEpisode = episode;

        Storage.addToHistory({ ...media, season, episode });

        this.container.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        this.renderPlayerModal();
        setTimeout(() => window.app?.nav?.focusDefault(), 50);

        if (media.media_type === 'tv' || media.first_air_date) {
            await this.loadTVDetails(media.id);
        }
    }

    close() {
        this.container.classList.add('hidden');
        document.body.style.overflow = '';
        this.container.innerHTML = '';
        this.currentMedia = null;
        if (this._overlayTimer) clearInterval(this._overlayTimer);
        setTimeout(() => window.app?.nav?.focusDefault(), 50);
    }

    async loadTVDetails(id) {
        try {
            this.tvData = await API.getDetails('tv', id);
            this.updateEpisodeSelectors();
        } catch (err) {
            console.warn('Could not fetch TV details:', err);
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────
    renderPlayerModal() {
        const isTv  = this.currentMedia.media_type === 'tv' || !!this.currentMedia.first_air_date;
        const embedUrl = isTv
            ? this.currentServer.getTvUrl(this.currentMedia.id, this.currentSeason, this.currentEpisode)
            : this.currentServer.getMovieUrl(this.currentMedia.id);

        this.container.innerHTML = `
            <div class="player-modal-content">
                <div class="video-frame-container" id="video-frame-container" style="flex:1;position:relative;background:#000;">
                    <iframe
                        id="player-iframe"
                        src="${embedUrl}"
                        allowfullscreen="true"
                        webkitallowfullscreen="true"
                        mozallowfullscreen="true"
                        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                        referrerpolicy="no-referrer"
                        scrolling="no"
                        title="Video Player"
                        style="position:absolute;inset:0;width:100%;height:100%;border:none;"
                    ></iframe>
                </div>
            </div>
        `;

        this.bindEvents();
        this.startAdSweeper();
    }

    // ── Periodic Ad Sweeper ──────────────────────────────────────────────────
    // Runs every 500 ms and kills any popup/overlay iframes injected outside the player
    startAdSweeper() {
        const playerModal = this.container;

        this._overlayTimer = setInterval(() => {
            // Remove any <iframe> added outside #player-modal (ad popups)
            document.querySelectorAll('body > iframe, body > div > iframe').forEach(f => {
                if (!playerModal.contains(f)) {
                    f.remove();
                }
            });

            // Kill fixed-position overlays with insane z-index outside player
            document.querySelectorAll('body > div, body > a').forEach(el => {
                if (playerModal.contains(el)) return;
                const st = window.getComputedStyle(el);
                if (st.position === 'fixed' && parseInt(st.zIndex, 10) > 9000) {
                    el.remove();
                }
            });
        }, 500);
    }

    // ── Events ───────────────────────────────────────────────────────────────
    bindEvents() {
        // The player is pure full-screen. Back button is handled by navigation.js.
        // No on-screen controls exist in the player itself.
    }

    // ── Server Switch ────────────────────────────────────────────────────────
    switchServer() {
        const isTv  = this.currentMedia.media_type === 'tv' || !!this.currentMedia.first_air_date;
        const iframe = document.getElementById('player-iframe');
        if (!iframe) return;

        // Update active pill
        this.container.querySelectorAll('.server-pill').forEach(p => {
            p.classList.toggle('active', p.dataset.serverId === this.currentServer.id);
        });

        Storage.addToHistory({
            ...this.currentMedia,
            season:  this.currentSeason,
            episode: this.currentEpisode
        });

        const badge = this.container.querySelector('.player-badge');
        if (badge && isTv) badge.textContent = `S${this.currentSeason} E${this.currentEpisode}`;

        const newUrl = isTv
            ? this.currentServer.getTvUrl(this.currentMedia.id, this.currentSeason, this.currentEpisode)
            : this.currentServer.getMovieUrl(this.currentMedia.id);

        iframe.src = newUrl;

    }

    // ── Episode Selectors ────────────────────────────────────────────────────
    updateEpisodeSelectors() {
        if (!this.tvData?.seasons) return;
        const seasonSelect = document.getElementById('season-select');
        if (!seasonSelect) return;

        const validSeasons = this.tvData.seasons.filter(s => s.season_number > 0);
        seasonSelect.innerHTML = validSeasons.map(s => `
            <option value="${s.season_number}" ${s.season_number === this.currentSeason ? 'selected' : ''}>
                Season ${s.season_number} (${s.episode_count} eps)
            </option>
        `).join('');

        this.updateEpisodeOptions();
    }

    updateEpisodeOptions() {
        const episodeSelect = document.getElementById('episode-select');
        if (!episodeSelect) return;

        let epCount = 24;
        if (this.tvData?.seasons) {
            const sObj = this.tvData.seasons.find(s => s.season_number === this.currentSeason);
            if (sObj) epCount = sObj.episode_count;
        }

        let options = '';
        for (let i = 1; i <= epCount; i++) {
            options += `<option value="${i}" ${i === this.currentEpisode ? 'selected' : ''}>Episode ${i}</option>`;
        }
        episodeSelect.innerHTML = options;
    }

    // ── Utility ──────────────────────────────────────────────────────────────
    escapeHtml(str) {
        return (str || '').replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }
}
