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
  const HEART = { sheet: 'pp', full: 44, empty: 46 };

  // Five spells, one per pitch band, low to high.
  const SPELLS = [
    { key: 'flame', icon: '🔥', color: '#ff6b3d' },
    { key: 'frost', icon: '❄️', color: '#5ee0ff' },
    { key: 'thunder', icon: '⚡', color: '#ffe14d' },
    { key: 'gale', icon: '🌪️', color: '#8cff9a' },
    { key: 'light', icon: '✨', color: '#ffd1f7' },
  ];

  // Voice range presets as MIDI note numbers; five equal bands in log space.
  // A tuned ("custom") range replaces these after the wand-tuning step.
  const RANGES = {
    kid: { lo: 52, hi: 92 },    // E3 – G#6
    adult: { lo: 36, hi: 76 },  // C2 – E5
    wide: { lo: 36, hi: 96 },   // C2 – C7, one octave per spell like the original
  };

  // Loot ids map to effects in game.js:
  //   tonic  refills one heart when a floor starts
  //   wand   spells charge 20% faster
  //   needle block windows last longer
  //   ring   +8 seconds on every floor
  //   crest  unlocks the bonus roof floor
  //   chest  trophy for finishing the roof
  const FLOORS = [
    {
      id: 'cellar',
      boss: { sheet: 'td', tile: 108, scale: 3 },
      hp: 100, time: 45, weak: [2, 1],
      attackEvery: 7.5, block: 2.4, patternLen: 2,
      loot: { sheet: 'td', tile: 114, id: 'tonic' },
      ground: { sheet: 'pp', top: [1, 2], body: [121, 122] },
      accent: '#5ce27a', sky: ['#06102a', '#12354a'],
    },
    {
      id: 'belfry',
      boss: { sheet: 'td', tile: 120, scale: 3, fly: true },
      hp: 120, time: 45, weak: [1, 2],
      attackEvery: 7, block: 2.3, patternLen: 2,
      loot: { sheet: 'td', tile: 129, id: 'wand' },
      ground: { sheet: 'td', top: [36, 37, 38, 39], body: [36, 37] },
      accent: '#a98cff', sky: ['#0a0a2a', '#2a1a55'],
    },
    {
      id: 'stairwell',
      boss: { sheet: 'td', tile: 122, scale: 3 },
      hp: 140, time: 45, weak: [3, 1],
      attackEvery: 6.5, block: 2.2, patternLen: 3,
      loot: { sheet: 'td', tile: 103, id: 'needle' },
      ground: { sheet: 'pp', top: [41, 42], body: [121, 122] },
      accent: '#c9b48a', sky: ['#0d0b24', '#3a2e4a'],
    },
    {
      id: 'gallery',
      boss: { sheet: 'td', tile: 121, scale: 3, fly: true },
      hp: 160, time: 50, weak: [0, 4],
      attackEvery: 6, block: 2.2, patternLen: 3,
      loot: { sheet: 'td', tile: 101, id: 'ring' },
      ground: { sheet: 'pp', top: [81, 82], body: [121, 122] },
      accent: '#8fe9ff', sky: ['#071233', '#1a3f6e'],
    },
    {
      id: 'crown',
      boss: { sheet: 'td', tile: 109, scale: 4 },
      hp: 220, time: 60, weak: [4, 0],
      attackEvery: 5.5, block: 2.0, patternLen: 3,
      loot: { sheet: 'td', tile: 29, id: 'crest' },
      ground: { sheet: 'pp', top: [41, 42], body: [121, 122] },
      accent: '#ffb347', sky: ['#1a0a1e', '#5a1e2e'],
    },
    {
      id: 'roof', bonus: true,
      boss: { sheet: 'td', tile: 110, scale: 4 },
      hp: 260, time: 70, weak: [1, 3, 4],
      attackEvery: 5, block: 2.0, patternLen: 3,
      loot: { sheet: 'td', tile: 91, id: 'chest' },
      ground: { sheet: 'td', top: [36, 37, 38, 39], body: [36, 37] },
      accent: '#ff5c5c', sky: ['#160408', '#4a1020'],
    },
  ];

  window.VoxLevels = { SHEETS, HERO, HEART, SPELLS, RANGES, FLOORS };
})();
