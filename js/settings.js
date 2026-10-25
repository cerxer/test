// Persistent user settings (localStorage).
const KEY = 'voxelcraft.settings.v1';

export function detectTouch() {
  return (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window || navigator.maxTouchPoints > 1;
}

export function defaultSettings() {
  const touch = detectTouch();
  return {
    renderDistance: touch ? 4 : 7,
    fov: 75,
    sensitivity: 1,
    touchSensitivity: 1,
    invertY: false,
    volume: 0.6,
    brightness: 0.5,
    viewBobbing: true,
    autoJump: touch,
    showFps: false,
    clouds: true,
    dayLength: 20,
    pixelRatio: 'auto',
    touchControls: 'auto',
    mobs: true,
  };
}

export function loadSettings() {
  const s = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(s, JSON.parse(raw));
  } catch (e) {
    /* storage unavailable: keep defaults */
  }
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    /* ignore */
  }
}

// Schema used to build the settings screen.
export const SETTINGS_SCHEMA = [
  { key: 'renderDistance', label: 'Render Distance', type: 'range', min: 2, max: 16, step: 1, format: (v) => v + ' chunks' },
  { key: 'fov', label: 'FOV', type: 'range', min: 50, max: 110, step: 1, format: (v) => String(v) },
  { key: 'sensitivity', label: 'Mouse Sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05, format: (v) => Math.round(v * 100) + '%' },
  { key: 'touchSensitivity', label: 'Touch Look Speed', type: 'range', min: 0.2, max: 3, step: 0.05, format: (v) => Math.round(v * 100) + '%' },
  { key: 'volume', label: 'Sound Volume', type: 'range', min: 0, max: 1, step: 0.05, format: (v) => (v === 0 ? 'OFF' : Math.round(v * 100) + '%') },
  { key: 'brightness', label: 'Brightness', type: 'range', min: 0, max: 1, step: 0.05, format: (v) => (v < 0.15 ? 'Moody' : v > 0.85 ? 'Bright' : Math.round(v * 100) + '%') },
  { key: 'dayLength', label: 'Day Length', type: 'choice', options: [[5, '5 min'], [10, '10 min'], [20, '20 min'], [40, '40 min']] },
  { key: 'pixelRatio', label: 'Resolution', type: 'choice', options: [['auto', 'Auto'], [0.5, '50%'], [0.75, '75%'], [1, '100%'], [1.5, '150%'], [2, '200%']] },
  { key: 'clouds', label: 'Clouds', type: 'toggle' },
  { key: 'viewBobbing', label: 'View Bobbing', type: 'toggle' },
  { key: 'autoJump', label: 'Auto-Jump', type: 'toggle' },
  { key: 'invertY', label: 'Invert Mouse', type: 'toggle' },
  { key: 'showFps', label: 'Show FPS', type: 'toggle' },
  { key: 'mobs', label: 'Spawn Mobs', type: 'toggle' },
  { key: 'touchControls', label: 'Touch Controls', type: 'choice', options: [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']] },
];
