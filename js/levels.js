/* Vox Tower — sprite sheets, spells, voice ranges and floor data.
 * Sprites: Kenney "Tiny Dungeon" (16px, 12 columns) and "Pixel Platformer"
 * (18px, 20 columns), both CC0. Tile index = row * columns + column.
 * Exposes window.VoxLevels.
 */
(function () {
  'use strict';

  const SHEETS = {
    td: { src: 'assets/kenney/tiny-dungeon.png', tile: 16, cols: 12 },
    pp: { src: 'assets/kenney/pixel-platformer.png', tile: 18, cols: 20 },
  };

  const HERO = { sheet: 'td', tile: 84 }; // purple-hat wizard

  // Five spells, one per pitch band, low to high.
  const SPELLS = [
    { key: 'flame', icon: '🔥', color: '#ff6b3d' },
    { key: 'frost', icon: '❄️', color: '#5ee0ff' },
    { key: 'thunder', icon: '⚡', color: '#ffe14d' },
    { key: 'gale', icon: '🌪️', color: '#8cff9a' },
    { key: 'light', icon: '✨', color: '#ffd1f7' },
  ];

  // Voice ranges as MIDI note numbers; five equal bands in log space.
  // kid: E3–G#6 (8 semitones per band), adult: C2–E5, wide: C2–C7 (one octave each)
  const RANGES = {
    kid: { lo: 52, hi: 92 },
    adult: { lo: 36, hi: 76 },
    wide: { lo: 36, hi: 96 },
  };

  const FLOORS = [
    {
      id: 'cellar',
      boss: { sheet: 'td', tile: 108, scale: 3 },
      hp: 100, time: 45,
      weak: [2],
      loot: { sheet: 'td', tile: 114 },
      ground: { sheet: 'pp', top: [1, 2], body: [121, 122] },
      accent: '#5ce27a',
      sky: ['#06102a', '#12354a'],
    },
    {
      id: 'belfry',
      boss: { sheet: 'td', tile: 120, scale: 3, fly: true },
      hp: 120, time: 45,
      weak: [1],
      loot: { sheet: 'td', tile: 129 },
      ground: { sheet: 'td', top: [36, 37, 38, 39], body: [36, 37] },
      accent: '#a98cff',
      sky: ['#0a0a2a', '#2a1a55'],
    },
    {
      id: 'stairwell',
      boss: { sheet: 'td', tile: 122, scale: 3 },
      hp: 140, time: 45,
      weak: [3],
      loot: { sheet: 'td', tile: 103 },
      ground: { sheet: 'pp', top: [41, 42], body: [121, 122] },
      accent: '#c9b48a',
      sky: ['#0d0b24', '#3a2e4a'],
    },
    {
      id: 'gallery',
      boss: { sheet: 'td', tile: 121, scale: 3, fly: true },
      hp: 160, time: 50,
      weak: [0],
      loot: { sheet: 'td', tile: 101 },
      ground: { sheet: 'pp', top: [81, 82], body: [121, 122] },
      accent: '#8fe9ff',
      sky: ['#071233', '#1a3f6e'],
    },
    {
      id: 'crown',
      boss: { sheet: 'td', tile: 109, scale: 4 },
      hp: 220, time: 60,
      weak: [4, 0], // phase 1: Light, phase 2 (below half HP): Flame
      loot: { sheet: 'td', tile: 29 },
      ground: { sheet: 'pp', top: [41, 42], body: [121, 122] },
      accent: '#ffb347',
      sky: ['#1a0a1e', '#5a1e2e'],
    },
  ];

  window.VoxLevels = { SHEETS, HERO, SPELLS, RANGES, FLOORS };
})();
