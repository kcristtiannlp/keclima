/**
 * Visualizador de satélite infravermelho (GOES NOAA) — estilo Climatempo.
 * @module widgets/SatelliteWidget
 */

import { el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { fetchGoesInfrared } from '../api/providers/satellite.js';
import { toastError } from '../services/toastService.js';

const SECTORS = [
  { id: 'ssa', labelKey: 'sat_sector_ssa' },
  { id: 'taw', labelKey: 'sat_sector_taw' },
  { id: 'fd', labelKey: 'sat_sector_fd' },
];

export class SatelliteWidget {
  constructor() {
    this.root = null;
    this._sector = 'ssa';
    this._frames = [];
    this._index = 0;
    this._playing = false;
    this._timer = null;
    this._abort = null;
    this._img = null;
    this._meta = null;
    this._status = null;
    this._slider = null;
    this._playBtn = null;
    this._data = null;
  }

  mount() {
    this.root = el('div', { className: 'sat-panel' });

    const toolbar = el('div', { className: 'sat-toolbar' });
    const sectorWrap = el('div', { className: 'sat-sector-group', role: 'group' });
    this._sectorBtns = {};
    for (const s of SECTORS) {
      const btn = el('button', {
        type: 'button',
        className: `btn btn-sm sat-sector-btn${s.id === this._sector ? ' active' : ''}`,
        text: t(s.labelKey),
        onClick: () => this._setSector(s.id),
      });
      this._sectorBtns[s.id] = btn;
      sectorWrap.append(btn);
    }

    this._playBtn = el('button', {
      type: 'button',
      className: 'btn btn-sm sat-play',
      text: '▶',
      title: t('sat_play'),
      onClick: () => this._togglePlay(),
    });
    const prevBtn = el('button', {
      type: 'button',
      className: 'btn btn-sm',
      text: '⏮',
      title: t('sat_prev'),
      onClick: () => {
        this._stopPlay();
        this._setIndex(this._index - 1);
      },
    });
    const nextBtn = el('button', {
      type: 'button',
      className: 'btn btn-sm',
      text: '⏭',
      title: t('sat_next'),
      onClick: () => {
        this._stopPlay();
        this._setIndex(this._index + 1);
      },
    });
    const latestBtn = el('button', {
      type: 'button',
      className: 'btn btn-sm',
      text: t('sat_latest'),
      onClick: () => {
        this._stopPlay();
        this._setIndex(this._frames.length - 1);
      },
    });
    const refreshBtn = el('button', {
      type: 'button',
      className: 'btn btn-sm',
      text: t('sat_refresh'),
      onClick: () => this.load({ force: true }),
    });

    this._slider = el('input', {
      type: 'range',
      className: 'sat-slider',
      min: '0',
      max: '0',
      value: '0',
      'aria-label': t('sat_timeline'),
    });
    this._slider.addEventListener('input', () => {
      this._stopPlay();
      this._setIndex(Number(this._slider.value));
    });

    toolbar.append(
      sectorWrap,
      el('div', { className: 'sat-controls' }, [
        this._playBtn,
        prevBtn,
        nextBtn,
        latestBtn,
        refreshBtn,
      ]),
      this._slider
    );

    this._status = el('p', { className: 'sat-status muted', text: t('sat_loading') });
    this._meta = el('p', { className: 'sat-meta muted', text: '' });

    const stage = el('div', { className: 'sat-stage' });
    this._img = el('img', {
      className: 'sat-image',
      alt: t('sat_title'),
      decoding: 'async',
    });
    this._img.addEventListener('error', () => {
      if (this._status) this._status.textContent = t('sat_image_error');
    });
    stage.append(this._img);

    const colorBar = el('div', { className: 'sat-colorbar' }, [
      el('div', { className: 'sat-colorbar-gradient' }),
      el('div', { className: 'sat-colorbar-labels' }, [
        el('span', { text: '-80°C (Nuvens Frias / Tempestades)' }),
        el('span', { text: '-50°C' }),
        el('span', { text: '-30°C' }),
        el('span', { text: '0°C' }),
        el('span', { text: '+40°C (Solo Limpo)' }),
      ])
    ]);

    const legend = el('div', { className: 'sat-legend' }, [
      el('h3', { className: 'sat-legend-title', text: t('sat_title') }),
      el('p', { className: 'muted', text: t('sat_desc') }),
      el('p', { className: 'muted sat-hint', text: t('sat_hint') }),
    ]);

    this.root.append(toolbar, this._status, this._meta, stage, colorBar, legend);
    this.load();
    return this.root;
  }

  destroy() {
    this._stopPlay();
    if (this._abort) {
      this._abort.abort();
      this._abort = null;
    }
    this.root = null;
  }

  /**
   * @param {{ force?: boolean }} [opts]
   */
  async load(opts = {}) {
    if (this._abort) this._abort.abort();
    this._abort = new AbortController();
    if (this._status) this._status.textContent = t('sat_loading');
    this._stopPlay();

    try {
      // force: bypass client cache with unique size request already short TTL
      const data = await fetchGoesInfrared({
        sector: this._sector,
        size: this._sector === 'fd' ? '900x540' : '900x540',
        limit: 36,
        signal: this._abort.signal,
      });
      this._data = data;
      this._frames = data.frames || [];
      if (!this._frames.length && data.latest) {
        this._frames = [
          {
            id: 'latest',
            url: data.latest,
            time: null,
          },
        ];
      }
      this._index = Math.max(0, this._frames.length - 1);
      if (this._slider) {
        this._slider.max = String(Math.max(0, this._frames.length - 1));
        this._slider.value = String(this._index);
      }
      this._renderFrame();
      if (this._status) {
        const n = this._frames.length;
        this._status.textContent =
          n > 0
            ? `${t('sat_frames')}: ${n} · ${data.satellite || 'GOES'} · ${data.bandName || 'IR'}`
            : t('sat_none');
      }
      if (this._meta) {
        this._meta.textContent = `${data.sectorLabel || data.sector || ''} · ${data.attribution || data.source || 'NOAA'}`;
      }
      // autoplay suave como Climatempo
      if (this._frames.length > 2) {
        this._startPlay();
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.warn('[SatelliteWidget]', err);
      const msg =
        err?.code === 'sat_proxy_missing' ? t('sat_error_proxy') : t('sat_error');
      if (this._status) this._status.textContent = msg;
      toastError(msg);
    }
  }

  /** @param {string} sector */
  _setSector(sector) {
    if (this._sector === sector) return;
    this._sector = sector;
    for (const [id, btn] of Object.entries(this._sectorBtns || {})) {
      btn.classList.toggle('active', id === sector);
    }
    this.load();
  }

  _togglePlay() {
    if (this._playing) this._stopPlay();
    else this._startPlay();
  }

  _startPlay() {
    if (this._frames.length < 2) return;
    this._playing = true;
    if (this._playBtn) {
      this._playBtn.textContent = '⏸';
      this._playBtn.title = t('sat_pause');
    }
    this._timer = setInterval(() => {
      const next = this._index + 1;
      this._setIndex(next >= this._frames.length ? 0 : next);
    }, 450);
  }

  _stopPlay() {
    this._playing = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._playBtn) {
      this._playBtn.textContent = '▶';
      this._playBtn.title = t('sat_play');
    }
  }

  /** @param {number} i */
  _setIndex(i) {
    if (!this._frames.length) return;
    const n = this._frames.length;
    this._index = ((i % n) + n) % n;
    if (this._slider) this._slider.value = String(this._index);
    this._renderFrame();
  }

  _renderFrame() {
    const fr = this._frames[this._index];
    if (!fr || !this._img) return;
    const url = fr.url || this._data?.latest;
    if (!url) return;
    // preload next for smoother loop
    if (this._frames.length > 1) {
      const nfr = this._frames[(this._index + 1) % this._frames.length];
      if (nfr?.url) {
        const pre = new Image();
        pre.src = nfr.url;
      }
    }
    this._img.src = url;
    let timeLabel = '—';
    if (fr.time) {
      try {
        timeLabel = new Date(fr.time).toLocaleString(undefined, {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
        });
      } catch {
        timeLabel = String(fr.time);
      }
    }
    if (this._status && this._frames.length) {
      this._status.textContent = `${t('sat_frame')}: ${this._index + 1}/${this._frames.length} · ${timeLabel}`;
    }
  }
}
