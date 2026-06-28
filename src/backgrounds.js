// ============================================================
// backgrounds.js — who the Wickmarked was before the coffin.
// Each background nudges starting stats, gear, coin, faction
// standing, and which spells start within reach.
// ============================================================
export const BACKGROUNDS = [
  {
    id: 'gravedigger', name: 'The Gravedigger',
    blurb: 'You dug the graves. You know which ones moved. Hardy, grim, hard to scare.',
    perk: '+2 Grit · +1 Instinct · the Gravedigger’s shovel · 30 soulgilt',
    apply(p, w, f) {
      p.stats.grit += 2; p.stats.instinct += 1; p.coin += 30; p.maxHP += 15; p.hp = p.maxHP;
      f.modify('wardens', 10, false);
      p.background = 'The Gravedigger';
    },
  },
  {
    id: 'hexwright', name: 'The Hexwright',
    blurb: 'A back-alley spell-smith. Your lantern hand was busy long before the ritual.',
    perk: '+3 Hex · +1 Wits · most spells already in reach · Mask Market favour',
    apply(p, w, f) {
      p.stats.hex += 3; p.stats.wits += 1; p.maxWisp += 30; p.wisp = p.maxWisp;
      f.modify('mask', 12, false); f.modify('harvest', 5, false);
      p.background = 'The Hexwright';
    },
  },
  {
    id: 'lawman', name: 'The Lawman',
    blurb: 'You carried a badge through too many Octobers. The revolver feels like a handshake.',
    perk: '+2 Aim · +1 Presence · +1 revolver capacity · Warden & Church standing',
    apply(p, w, f) {
      p.stats.aim += 2; p.stats.presence += 1; w.ammoMax += 1; w.ammo = w.ammoMax;
      f.modify('wardens', 8, false); f.modify('church', 6, false);
      p.background = 'The Lawman';
    },
  },
  {
    id: 'cinderwitch', name: 'The Cinder-Witch',
    blurb: 'You ran with the harvest covens. The corn still whispers your old name.',
    perk: '+2 Hex · +2 Guile · Children of the Harvest favour',
    apply(p, w, f) {
      p.stats.hex += 2; p.stats.guile += 2; p.maxWisp += 15; p.wisp = p.maxWisp;
      f.modify('harvest', 14, false); f.modify('church', -6, false);
      p.background = 'The Cinder-Witch';
    },
  },
  {
    id: 'mourner', name: 'The Mourner',
    blurb: 'You came to Hallow County for a funeral. You stayed for the apocalypse.',
    perk: '+1 Presence · +1 Grit · 60 soulgilt · no enemies, no friends, yet',
    apply(p, w, f) {
      p.stats.presence += 1; p.stats.grit += 1; p.coin += 60;
      p.background = 'The Mourner';
    },
  },
];
