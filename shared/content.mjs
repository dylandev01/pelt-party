import {MAPS,makeMap,spawnPoint} from './maps.mjs';
export {MAPS,makeMap,spawnPoint};

export const BUILD = '1.1.3';
export const TITLE = 'Pelt Party';

// Each season re-skins the whole game: ammo, sky, ground, weather, music key and props.
export const SEASONS = {
  halloween: { name: 'Pumpkin Panic', label: 'HALLOWEEN EDITION', pelt: 'pumpkins', ammo: 'PUMPKINS', wall: 'pumpkin wall', ground: '#7d8c6c', ground2: '#6b7a5e', path: '#9a8467', sky: '#2e2850', horizon: '#d86f7c', fog: '#4a3f66', accent: '#ff9a3c', glow: '#ffb35c', tree: '#d06a2c', tree2: '#9a4430', weather: 'embers', sun: '#ffc9a0', night: true },
  harvest: { name: 'Leaf Fort Frenzy', label: 'HARVEST EDITION', pelt: 'leaf balls', ammo: 'LEAF BALLS', wall: 'leaf wall', ground: '#a48d55', ground2: '#94804c', path: '#b49e78', sky: '#7a9ec4', horizon: '#f2c48d', fog: '#d9b98f', accent: '#f2a23a', glow: '#ffd18a', tree: '#d0612f', tree2: '#e0a33a', weather: 'leaves', sun: '#ffe0b0', night: false },
  frost: { name: 'Snowball Showdown', label: 'FROST EDITION', pelt: 'snowballs', ammo: 'SNOWBALLS', wall: 'snow wall', ground: '#e9f1f6', ground2: '#d6e3ec', path: '#c6d4de', sky: '#6f93c4', horizon: '#dfe9f5', fog: '#c9d9e8', accent: '#9fdcff', glow: '#fff1c9', tree: '#3d7064', tree2: '#2f5c55', weather: 'snow', sun: '#fff3dd', night: false },
  meadow: { name: 'Meadow Mischief', label: 'MEADOW EDITION', pelt: 'flower puffs', ammo: 'PUFFS', wall: 'hedge wall', ground: '#86ad6a', ground2: '#76a05e', path: '#cbb98f', sky: '#79b7d8', horizon: '#e8f3d8', fog: '#bfdcc9', accent: '#ffd25e', glow: '#fff3b8', tree: '#6aa35f', tree2: '#86b960', weather: 'petals', sun: '#fff6dc', night: false }
};
export function seasonFor(date = new Date(), override) {
  if (Object.hasOwn(SEASONS, override)) return override;
  const month = date.getUTCMonth();
  return month === 9 ? 'halloween' : month === 10 ? 'harvest' : month === 11 || month === 0 ? 'frost' : 'meadow';
}

// Looks are built by the supplied chibi rig (see src/world/characters.js).
export const CHARACTERS = [
  { id: 'pip', name: 'Pip', title: 'THE ALL-ROUNDER', color: '#7fc3c9', price: 0 },
  { id: 'dot', name: 'Dot', title: 'COZY COMPETITOR', color: '#e25b4f', price: 0 },
  { id: 'chad', name: 'Chad', title: 'ALWAYS IN A HURRY', color: '#e8b04c', price: 0 },
  { id: 'luna', name: 'Luna', title: 'MOONLIGHT MOTH', color: '#b69be0', price: 0 },
  { id: 'jingle', name: 'Jingle', title: 'SNOW DAY LEGEND', color: '#3f9b5a', price: 150 },
  { id: 'kit', name: 'Kit', title: 'PUDDLE JUMPER', color: '#f08a3c', price: 150 },
  { id: 'rex', name: 'Rex', title: 'BACKYARD CHAMP', color: '#d8434f', price: 250 },
  { id: 'mabel', name: 'Mabel', title: 'SWEET BUT SNEAKY', color: '#f3a9c4', price: 250 },
  { id: 'ozzy', name: 'Ozzy', title: 'FORT ARCHITECT', color: '#c98b5a', price: 350 },
  { id: 'yuki', name: 'Yuki', title: 'ICE PRINCESS', color: '#76bccd', price: 350 }
];
export const COSMETICS = [
  { id: 'none', name: 'Bare head', price: 0, rarity: 'Starter', icon: '○' },
  { id: 'beanie', name: 'Knit beanie', price: 0, rarity: 'Starter', icon: '◠' },
  { id: 'pumpkin', name: 'Pumpkin cap', price: 40, rarity: 'Common', icon: '◉' },
  { id: 'cat', name: 'Cat ears', price: 80, rarity: 'Common', icon: '▲' },
  { id: 'earmuffs', name: 'Earmuffs', price: 80, rarity: 'Common', icon: '◎' },
  { id: 'frog', name: 'Froggy', price: 100, rarity: 'Common', icon: '✿' },
  { id: 'elf', name: 'Elf hat', price: 140, rarity: 'Rare', icon: '♪' },
  { id: 'witch', name: 'Midnight witch', price: 160, rarity: 'Rare', icon: '△' },
  { id: 'antlers', name: 'Reindeer antlers', price: 180, rarity: 'Rare', icon: 'Y' },
  { id: 'santa', name: 'Santa hat', price: 200, rarity: 'Epic', icon: '★' },
  { id: 'tophat', name: 'Snowman top hat', price: 220, rarity: 'Epic', icon: '▀' },
  { id: 'crown', name: 'Gourd royalty', price: 300, rarity: 'Legendary', icon: '♛' }
];
export const CHARACTER_IDS = CHARACTERS.map(c => c.id);
export const HAT_IDS = COSMETICS.map(c => c.id);

// Pickups sit visibly on their pads so players can fight over them.
export const POWERS = {
  triple: { name: 'Triple Toss', short: 'TRIPLE', color: '#ffd25e', desc: 'Your next 3 throws split three ways.' },
  shield: { name: 'Snow Shield', short: 'SHIELD', color: '#8fe3ff', desc: 'Blocks every hit for 6 seconds.' },
  heal: { name: 'Hot Cocoa', short: 'COCOA', color: '#ff8a7a', desc: 'Back to full hearts.' },
  giga: { name: 'Giga Ball', short: 'GIGA', color: '#c79bff', desc: 'Next charged throw is free with a huge splash.' },
  rush: { name: 'Sugar Rush', short: 'RUSH', color: '#7dff9b', desc: '35% faster with instant dive refills for 7 seconds.' }
};
export const POWER_IDS = Object.keys(POWERS);

// One table for every tuning number shared by client prediction and room validation.
export const RULES = {
  hp: 3, maxAmmo: 8, startAmmo: 5,
  run: 6.2, sprint: 8.6, crouch: 3.4, charging: 4.8, rush: 1.35,
  diveSpeed: 15.5, diveMove: 380, diveSafe: 300, diveCharges: 2, diveRecharge: 1500,
  slideSpeed: 12, slideTime: 650, slideCooldown: 900,
  throwCooldown: 260, chargeTime: 550, chargedCooldown: 700,
  buildCooldown: 4500, wallsPerPlayer: 2, wallLife: 30000, segmentHp: 3,
  scoopEvery: 340, pileEvery: 140, respawn: 2200, spawnShield: 1500,
  frenzy: 30000, padRespawn: 15000, shieldTime: 6000, rushTime: 7000
};
