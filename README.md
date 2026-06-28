# 🎃 HALLOWIND

**A Bethesda-style open-world Halloween-horror RPG FPS — playable in your browser.**

> *Oblivion, if Oblivion were a haunted Hallow's Eve that never ends.*

You wake in a coffin in the basement of the Bellweather Funeral Home with an iron
lantern fused to your hand — lit, but with no flame inside, just a small cold moon.
Outside, Gravewick is decorated for Halloween. The church bell rings thirteen times.
Every jack-o'-lantern turns its face toward you. Welcome to **Hallow County**, trapped
in *The Long October*.

This is a real, runnable vertical slice built on [Three.js](https://threejs.org/):
a seamless 3D open world, gun + magic FPS combat, a Halloween bestiary with real AI,
Bethesda-style environmental storytelling, an RPG progression + Dread system, and a
giant three-phase field boss. **No build step, no asset downloads, no network** — it
runs entirely from local files (Three.js is vendored, all audio is synthesised live).

---

## ▶ Run it

You need any local web server (ES modules can't load from `file://`). The repo ships
a tiny zero-dependency one:

```bash
npm start          # → http://localhost:8080
# or:
python3 -m http.server 8080
```

Then open the URL, watch the intro, and click **DESCEND**. Click the screen once to
capture the mouse (pointer-lock); press **ESC** to release it.

> A discrete GPU is recommended for the volumetric fog, soft shadows and bloom-like
> flashes — but it runs on integrated graphics too.

---

## 🎮 Controls

| Input | Action |
|---|---|
| **WASD** / arrows | Move |
| **Mouse** | Look |
| **Shift** | Sprint |
| **Space** | Jump |
| **LMB** | Fire current arm (Bone Revolver) |
| **RMB** | Quick-cast Hexbolt (witchfire) |
| **F** | Light / dim the Iron Lantern |
| **Q** | **Lantern Flare** — AoE stun, reveals ghosts, relieves Dread |
| **1 / 2** | Select arm: Revolver / Hexbolt |
| **R** | Reload |
| **E** | Interact — read notes, take loot, **talk to NPCs**, enter buildings |
| **K / L** | Save / Load (also auto-saves) |
| **TAB** | County map |
| **ESC** | Release cursor / back out of menus |

---

## 🗺 What's in the slice

- **One seamless streaming county** (~1.8 km across) with analytic rolling terrain,
  six hand-themed regions, volumetric fog tinted per-region, a too-large moon that
  *blinks*, drifting leaf-litter and stars.
- **Six regions**, each with its own props, wind and palette: **Gravewick** (the
  starting town + funeral home), **Jackfield Acres** (cornfields, pumpkins,
  scarecrows, Marrowbarn), **Mournwood Forest** (dead trees, witch hut, green
  witchfire), **Ashfall Works** (factory + smokestacks), **Gallowsfen** (black-water
  marsh with wandering wisp-lights), and **The Thousand-Jack** (the boss arena).
- **Gun + magic FPS combat** with weighty feel: hitscan revolver with recoil, muzzle
  flash, reloads, a critical "One Last Bullet" on the sixth round; a witchfire
  Hexbolt projectile that scales with **Dread**; and the Lantern Flare.
- **A Halloween bestiary with real AI:**
  - **Scarecrows** — *freeze when you look at them, sprint when you don't.* Weak to witchfire.
  - **Jacklings** — fast pumpkin-headed swarm.
  - **Ghosts** — bullets pass through them; you must light them with the lantern, use
    witchfire, or a Lantern Flare to make them solid.
- **Marrow Jack**, a giant three-phase scarecrow boss who summons crow-swarms and
  rains telegraphed pumpkin-bombs, with a dedicated health bar.
- **Environmental storytelling** — hand-written notes scattered across the county
  (the Bellweather thirteenth-chair tableau, the embalmer's ledger, Drowned Mercy's
  last census…), readable with **E**.
- **RPG systems** — eight attributes, XP/leveling with stat growth, named loot that
  grants perks, and a main-quest objective chain ("Silence the First Harvest Bell").
- **The Dread meter** — rises in the dark and near the dead; at high Dread the world
  whispers true lore, the screen warps, and your witchfire hits *harder*. The lantern
  and the Flare push it back down.
- **Fully procedural audio** — wind, a Dread-reactive drone, gunshots, bells, ghost
  hiss and the boss roar, all synthesised at runtime via the Web Audio API.

### …and the expanded systems

- **Talkable NPCs with branching, stat-checked dialogue** — Deputy Holloway (county
  gossip + a Presence check to get deputized) and Mara Vale (a Lantern Warden you
  can recruit). Options gate on `[Presence]`, `[Hex]`, `[Monster Lore]`, etc.
- **A Mask Market vendor + soulgilt currency** — enemies drop soulgilt; spend it on
  healing, a permanent revolver-capacity mod, or stat shards.
- **A recruitable companion** — Mara Vale follows you and guns down the things you miss.
- **Enterable interior dungeons with a diegetic load-fade** — cross a threshold, the
  screen fades to black with a whisper, and you wake inside:
  - **The Bellweather House** — the thirteenth-chair tableau made real, guarded by a
    *Grief Wraith* mini-boss that drops **The Mourning Key**.
  - **Old Mother Grin's Hut** — a social boss: bargain for forbidden Harvestcraft,
    let her feed you, or draw on her and fight through the kitchen.
- **Handcrafted dynamic world events** — the Crying Bride asking directions to a
  church that burned sixty years ago, the Whispering Sack that knows your name, and
  a scarecrow that creeps closer every time you look away.
- **A new enemy** — the **Moonbitten** werebeast prowls Mournwood; brutal, fast, weak
  to silver.
- **Save / load** to `localStorage` (K / L, plus autosave) — because the loop may
  repeat, but your progress shouldn't.

> **Performance note:** rather than a real light per pumpkin (200+ would crush a
> forward renderer), every glow is a free emissive sprite and a fixed pool of ~10
> real point-lights is distance-culled to the nearest glow points each frame.

---

## 🧭 First objectives

1. Press **F** to light the lantern.
2. Read the **embalmer's ledger** by the funeral home, just north of the town well.
3. Head **east** into Jackfield Acres.
4. Find Marrow Jack's true name (the farmers hid it where he can't read).
5. Reach **The Thousand-Jack** and silence the first Harvest Bell.

---

## 🏗 Architecture

Plain ES modules, no bundler. Each system is one file under `src/`:

| File | Responsibility |
|---|---|
| `main.js` | Renderer, input, intro, game loop, HUD, compass, map |
| `world.js` | Terrain, atmosphere, regions, props, colliders |
| `player.js` | FP controller, RPG stats, leveling, Dread, lantern |
| `weapons.js` | Revolver, spells, view-model, combat feel |
| `enemies.js` | Bestiary, AI state machines, Marrow Jack boss |
| `items.js` | Interactables, notes, loot |
| `quests.js` | Main-quest objective chain |
| `dialogue.js` | Branching dialogue runner with stat checks |
| `npc.js` | Talkable NPCs, vendor + currency, companion |
| `interiors.js` | Interior dungeons + diegetic load-fade |
| `events.js` | Handcrafted dynamic world encounters |
| `save.js` | localStorage save/load |
| `audio.js` | Procedural Web Audio engine |
| `utils.js` | Seeded RNG + shared helpers |
| `vendor/three.module.js` | Vendored Three.js r161 (so there's no CDN dependency) |

The world is seeded (`makeRng(1031)`), so *the loop repeats the same* every session —
fitting for a county stuck in The Long October.

---

## 🔭 Scope & honest notes

This is a **vertical slice / prototype**, not the 200-hour game from the design doc.
It now implements the core pillars *and* a second tier — open world, gun+magic
gameplay, AI enemies + a giant boss, environmental storytelling, RPG/Dread systems,
branching dialogue, NPCs + a vendor economy, a companion, enterable interiors with
diegetic loading, dynamic world events, and save/load — at a scale one developer can
ship in a single project. The rest of the design (all 13 Harvest Bells and the five
endings, six full faction questlines, the megadungeon interiors, deep crafting) lives
in the brief; the code here is the foundation you'd grow it from.

Built with Three.js (MIT). Everything else is original and self-contained.
