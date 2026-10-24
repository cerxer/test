// Menu screens: title, world select, create world, settings, help, pause, death, loading.
import { SETTINGS_SCHEMA, saveSettings } from '../settings.js';

const SCREENS = ['main', 'worlds', 'create', 'settings', 'help', 'pause', 'dead', 'loading', 'confirm'];

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class Screens {
  constructor(game) {
    this.game = game;
    this.els = {};
    for (const id of SCREENS) this.els[id] = document.getElementById('screen-' + id);
    this.current = null;
    this.settingsReturn = 'main';
    this.selectedWorld = null;
    this.worlds = [];
    this.createMode = 'survival';
    document.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!b) return;
      this.game.audio.ensure();
      this.game.audio.click();
      this.action(b.dataset.action);
    });
    document.getElementById('world-seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.action('create-confirm'); });
    document.getElementById('world-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.action('create-confirm'); });
    document.getElementById('rotate-dismiss').addEventListener('click', () => {
      this.rotateDismissed = true;
      document.getElementById('rotate-hint').classList.add('hidden');
    });
    const dirt = game.textures.canvases[game.textures.T.dirt].toDataURL();
    document.documentElement.style.setProperty('--dirt', `url(${dirt})`);
  }

  init() {
    const st = document.getElementById('storage-status');
    st.textContent = this.game.storage.persistent ? 'Worlds are saved in this browser' : 'Warning: browser storage unavailable – worlds will not be saved';
    this.show('main');
  }

  show(name) {
    for (const id of SCREENS) this.els[id].classList.toggle('hidden', id !== name);
    this.current = name;
  }

  hideAll() {
    for (const id of SCREENS) this.els[id].classList.add('hidden');
    this.current = null;
  }

  async action(a) {
    const g = this.game;
    switch (a) {
      case 'play': await this.openWorlds(true); break;
      case 'create': this.openCreate(); break;
      case 'settings':
        this.settingsReturn = this.current || 'main';
        if (g.overlay === 'pause') g.overlay = 'settings';
        this.renderSettings();
        this.show('settings');
        break;
      case 'settings-done':
        saveSettings(g.settings);
        g.applySettings();
        if (g.overlay === 'settings') g.overlay = 'pause';
        this.show(this.settingsReturn === 'settings' ? 'main' : this.settingsReturn);
        if (this.settingsReturn === 'pause') this.updatePause();
        break;
      case 'help': this.show('help'); break;
      case 'back-main': this.show('main'); break;
      case 'back-worlds':
        if (this.worlds.length) await this.openWorlds(false); else this.show('main');
        break;
      case 'play-selected':
        if (this.selectedWorld) g.loadWorld(this.selectedWorld);
        break;
      case 'delete-selected': {
        const w = this.worlds.find((x) => x.id === this.selectedWorld);
        if (!w) break;
        const ok = await this.confirm(`Delete "${w.name}"?`, `'${w.name}' will be lost forever! (A long time!)`, 'Delete');
        if (ok) {
          await g.storage.deleteWorld(w.id);
          this.selectedWorld = null;
        }
        await this.openWorlds(false);
        break;
      }
      case 'toggle-mode':
        this.createMode = this.createMode === 'survival' ? 'creative' : 'survival';
        this.updateCreateMode();
        break;
      case 'create-confirm': {
        const name = document.getElementById('world-name').value.trim() || 'New World';
        const seed = document.getElementById('world-seed').value;
        g.createWorld({ name, seedText: seed, mode: this.createMode });
        break;
      }
      case 'resume': g.resume(); break;
      case 'switch-mode': g.toggleGameMode(); this.updatePause(); break;
      case 'save-quit': g.quitToTitle(); break;
      case 'respawn': g.respawn(); break;
      default: break;
    }
  }

  async openWorlds(fromPlay) {
    this.worlds = await this.game.storage.listWorlds();
    if (fromPlay && !this.worlds.length) { this.openCreate(); return; }
    const list = document.getElementById('world-list');
    if (!this.worlds.length) list.innerHTML = '<div class="empty-list">No worlds yet. Create one!</div>';
    else {
      if (!this.worlds.find((w) => w.id === this.selectedWorld)) this.selectedWorld = this.worlds[0].id;
      list.innerHTML = this.worlds.map((w) => {
        const date = new Date(w.lastPlayed || w.created || Date.now());
        const mode = w.mode === 'creative' ? 'Creative' : 'Survival';
        return `<div class="world-item${w.id === this.selectedWorld ? ' sel' : ''}" data-id="${escapeHTML(w.id)}">
          <b>${escapeHTML(w.name)}</b>
          <div>${mode} Mode · Last played ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div>Seed: ${escapeHTML(w.seedText ?? w.seed)}</div></div>`;
      }).join('');
      for (const el of list.querySelectorAll('.world-item')) {
        el.addEventListener('click', () => {
          this.selectedWorld = el.dataset.id;
          for (const o of list.querySelectorAll('.world-item')) o.classList.toggle('sel', o === el);
        });
        el.addEventListener('dblclick', () => this.game.loadWorld(el.dataset.id));
      }
    }
    const has = this.worlds.length > 0;
    this.els.worlds.querySelector('[data-action="play-selected"]').disabled = !has;
    this.els.worlds.querySelector('[data-action="delete-selected"]').disabled = !has;
    this.show('worlds');
  }

  openCreate() {
    document.getElementById('world-name').value = 'New World';
    document.getElementById('world-seed').value = '';
    this.createMode = 'survival';
    this.updateCreateMode();
    this.show('create');
  }

  updateCreateMode() {
    document.getElementById('mode-toggle').textContent = 'Game Mode: ' + (this.createMode === 'survival' ? 'Survival' : 'Creative');
    document.getElementById('mode-desc').textContent = this.createMode === 'survival'
      ? 'Search for resources, craft, gain health and hunger. Monsters come out at night.'
      : 'Unlimited resources, free flying and instant block breaking.';
  }

  renderSettings() {
    const s = this.game.settings;
    const box = document.getElementById('settings-list');
    box.innerHTML = '';
    for (const def of SETTINGS_SCHEMA) {
      if (def.key === 'touchSensitivity' && !this.game.isTouch) continue;
      const wrap = document.createElement('div');
      wrap.className = 'setting';
      if (def.type === 'range') {
        wrap.innerHTML = `<div class="slider"><div class="knob"></div><span></span><input type="range" min="${def.min}" max="${def.max}" step="${def.step}"></div>`;
        const input = wrap.querySelector('input'), label = wrap.querySelector('span'), knob = wrap.querySelector('.knob');
        input.value = s[def.key];
        const upd = () => {
          const v = Number(input.value);
          s[def.key] = v;
          label.textContent = `${def.label}: ${def.format(v)}`;
          const f = (v - def.min) / (def.max - def.min);
          knob.style.left = `calc((100% - 14px) * ${f})`;
          if (def.key === 'volume') this.game.audio.setVolume(v);
        };
        input.addEventListener('input', upd);
        upd();
      } else {
        const btn = document.createElement('button');
        btn.className = 'mc-btn';
        const upd = () => {
          let text;
          if (def.type === 'toggle') text = s[def.key] ? 'ON' : 'OFF';
          else {
            const opt = def.options.find((o) => o[0] === s[def.key]) || def.options[0];
            text = opt[1];
          }
          btn.textContent = `${def.label}: ${text}`;
        };
        btn.addEventListener('click', () => {
          this.game.audio.click();
          if (def.type === 'toggle') s[def.key] = !s[def.key];
          else {
            const i = def.options.findIndex((o) => o[0] === s[def.key]);
            s[def.key] = def.options[(i + 1) % def.options.length][0];
          }
          upd();
        });
        upd();
        wrap.appendChild(btn);
      }
      box.appendChild(wrap);
    }
  }

  updatePause() {
    const g = this.game;
    document.getElementById('pause-mode').textContent = 'Game Mode: ' + (g.player.creative ? 'Creative' : 'Survival');
    const info = document.getElementById('pause-info');
    info.textContent = g.worldMeta ? `${g.worldMeta.name} · Seed ${g.worldMeta.seedText ?? g.worldMeta.seed}` : '';
  }

  showPause() {
    this.updatePause();
    this.show('pause');
  }

  showDeath(msg) {
    document.getElementById('death-msg').textContent = msg;
    this.show('dead');
  }

  showLoading(title, detail = '') {
    document.getElementById('loading-title').textContent = title;
    document.getElementById('loading-detail').textContent = detail;
    document.getElementById('loading-bar').style.width = '0%';
    this.show('loading');
  }

  setLoadingProgress(f, detail) {
    document.getElementById('loading-bar').style.width = Math.round(f * 100) + '%';
    if (detail) document.getElementById('loading-detail').textContent = detail;
  }

  confirm(title, text, yes) {
    return new Promise((resolve) => {
      const prev = this.current;
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-text').textContent = text;
      const yesBtn = document.getElementById('confirm-yes'), noBtn = document.getElementById('confirm-no');
      yesBtn.textContent = yes;
      const done = (v) => {
        yesBtn.onclick = noBtn.onclick = null;
        this.show(prev);
        resolve(v);
      };
      yesBtn.onclick = () => done(true);
      noBtn.onclick = () => done(false);
      this.show('confirm');
    });
  }

  updateRotateHint() {
    const g = this.game;
    const show = g.isTouch && g.state === 'game' && innerHeight > innerWidth && !this.rotateDismissed;
    document.getElementById('rotate-hint').classList.toggle('hidden', !show);
  }
}
