# Vox Tower

**Play it:** https://josanshuo.github.io/voice-speller/

A voice-controlled pixel-art boss rush. Hum or sing into the microphone: the
pitch of your voice picks one of five spells, and each floor's monster is weak
to one of them. Clear five floors to cleanse the tower.

Inspired by the game 向阳乔木 (@vista8) built for their daughter
(https://x.com/vista8/status/2095130351534584049).

## Run it locally

The game is a static page (no build step, no server code). Any static file server works. From this folder:

```bash
python -m http.server 8765
```

Then open http://localhost:8765 in Chrome or Edge and allow the microphone.
Opening `index.html` directly also works in Chrome and Edge.

`python build.py` assembles the deployable site in `dist/`, including
`dist/vox-tower.html`, a single self-contained file you can send to anyone.

## How to play

1. **Enable microphone** on the title screen, then hum to see the meter move.
   Adjust *Mic sensitivity* until quiet room noise stays under the gold line.
2. **Tune your wand**: sing your lowest comfortable note, then your highest,
   and the five spell bands are spread across your own range. The presets
   (*Kid* E3 – G#6, *Grown-up* C2 – E5, *Wide* C2 – C7) remain available.
3. Each floor shows the monster's weakness and a voice tip. Hold a steady note
   inside that spell's band; every third of a second on pitch fires a spell.
   The weak spell does 12 damage, anything else does 3. Every monster shifts
   its weakness once at half health (the roof boss twice) and changes colour.
   The pitch ladder beside the wizard shows your note, the target band, and an
   arrow toward it.
4. **Attacks**: a red icon over the monster is a wind-up. Sing that spell
   before the bar empties to block it, or lose a heart. Three hearts per run;
   running out ends the floor (retrying restores them).
5. **Runes**: a gold chain of icons is an opening. Sing them in order for a
   30-damage rune break. Neither blocks nor rune steps count as wrong spells.
6. Beat the monster before the countdown ends. Stars: one for clearing, one
   for finishing with 40% of the time left, one for no wrong spells and no
   hearts lost. Finishing with only the weak spell earns the *Perfect bonus*.
7. **Loot has effects**: Bog Tonic refills a heart each floor, the Echo Wand
   charges spells faster, the Cobweb Needle lengthens block windows, the Frost
   Ring adds eight seconds per floor, and the Warden's Crest opens a bonus
   roof floor with a three-phase boss.
8. A tower map between floors shows your climb and best stars per floor. The
   five best runs on this device are kept in the browser (localStorage) and
   shown on the title screen; a run that makes the table can be given a short
   name. Scores never leave the device.

**No microphone?** Hold keys **1–5**, or press and hold a spell slot on the
dashboard. The **EN / 中文** toggle switches language.

## Files

- `index.html`, `css/style.css` — page and styling
- `js/pitch.js` — microphone pitch tracker (McLeod pitch method + median filter)
- `js/levels.js` — sprite sheets, spell bands, voice ranges, floor data
- `js/i18n.js` — English and Chinese strings
- `js/game.js` — rendering, battle logic, HUD, fallback input, sound effects
- `assets/kenney/` — sprite sheets (see credits)
- `build.py` — assembles the static site into `dist/` (ignored on `main`)
- `deploy.py` — builds, then force-pushes `dist/` to the `dist` branch

## Branches

- `main` — source.
- `dist` — the built static site, served by GitHub Pages at
  https://josanshuo.github.io/voice-speller/. Refresh it with `python deploy.py`.

## Credits

- Sprites: [Kenney](https://kenney.nl) — *Tiny Dungeon* and *Pixel Platformer*,
  both released under CC0 (license files are in `assets/kenney/`).
- Fonts: *Press Start 2P* and *Pixelify Sans* from Google Fonts (SIL OFL).
- Sound effects are synthesised in the browser with the Web Audio API.
