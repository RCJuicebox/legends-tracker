// A character as the game's export files and the wiki describe them, and what the player adds.

export interface AchObjective {
  t: string
  /** Complete. */
  d?: boolean
  /** Optional: never counts toward completion, as the game scores it. */
  o?: boolean
  /** Progress, [current, max]. */
  p?: [number, number]
}

export interface Achievement {
  n: string
  d?: boolean
  c: AchObjective[]
}

export interface AchSection {
  cat: string
  name: string
  ach: Achievement[]
}

/** What the player added on top of the export, kept by name. */
export interface AchMarks {
  /** Objectives ticked by hand: objKey(). */
  ticks: string[]
  /** Achievements marked Broken: achKey(). */
  broken: string[]
}

/** One line of the export: a location, the item there, and what sits inside it. */
export interface InvItem {
  /** "Head", "General 1-Slot3", "Bank10-Slot2". */
  location: string
  name: string
  id: number
  count: number
  /** Augments in its augment slots (worn gear holds its exaltations in slots 7-10). */
  augs: InvItem[]
}

export interface Inventory {
  /** Worn slots, in the export's order. The slot is the location. */
  worn: InvItem[]
  /** Bags and their contents: General 1-12. */
  bags: InvItem[]
  bank: InvItem[]
  sharedBank: InvItem[]
  /** The tradeskill depot (Personal-Depot1…), where auto-loot stores tradeskill items; absent from older exports. */
  depot: InvItem[]
  /**
   * The game's Storage window, which the export lists as its key ring: collections by kind (Equipment,
   * Augmentation, Activated, …). Gear in Storage › Equipment can be taken out and worn.
   */
  keyRing: { kind: string; name: string; id: number }[]
}

/** A character's achievements export as read from the game folder, with the player's own marks. */
export interface AchievementsView {
  /** Name_server, as the game names its files. */
  character: string
  file: string
  /** When the game last wrote the export; 0 when there is none. */
  modified: number
  sections: AchSection[]
  marks: AchMarks
  /** 'missing' when there is no export yet; otherwise a read error, or ''. */
  error: string
}

/** What an item is for, from its eqlwiki page: the notes, the quests and recipes it is used in. */
export interface ItemUse {
  /** The page's notes, markup stripped and cut short; '' for none. */
  notes: string
  /** Quests the page relates it to. */
  quests: string[]
  /** "Jewelcrafting: Silver Blue Diamond Ring (75)". */
  recipes: string[]
  /** What merchants pay, as the page words it; '' when unsaid. */
  value: string
  /** The merchants the page lists selling it. Absent on entries cached before it was kept. */
  vendors?: { zone: string; npc: string; note: string }[]
  /** Where else it comes from, when no vendor sells it. Absent on entries cached before it was kept. */
  sources?: ItemSources
}

/** An item's other sources, from its page: what drops it and where, where it is foraged, whether it is crafted. */
export interface ItemSources {
  drops: { zone: string; mobs: string[] }[]
  foraged: string[]
  crafted: boolean
}

/** An item's eqlwiki page, as far as the tracker uses it. */
export interface ItemInfo {
  /** The page title. */
  title: string
  /** False when the wiki has no page for it. */
  found: boolean
  /** The in-game stats block from the page, base (unmerged) values. */
  statsblock: string
  /** The item's icon number (the page's lucy_img_ID), 500 and up; 0 when unknown. */
  icon?: number
  /** Absent on entries cached before it was kept. */
  use?: ItemUse
  /** When the page was read from eqlwiki. */
  fetchedAt?: number
}

/** A character's inventory export, with what the wiki says about the items worn. */
export interface InventoryView {
  character: string
  file: string
  modified: number
  inventory: Inventory | null
  /** By itemKey(). */
  items: Record<string, ItemInfo>
  /** 'missing' when there is no export yet; otherwise a read error, or ''. */
  error: string
}

/** What the player has told the tracker about a character that no file records. */
export interface CharacterSheet {
  /** AC typed in for an item, by itemKey(); wins over the wiki. */
  acOverrides: Record<string, number>
  /** Whether the secondary item counts as a shield; null = go by its name. */
  shield: boolean | null
  /** The Stats page's inputs. */
  stats: Record<string, unknown>
}

/** What a game folder holds that the tracker can use. Character names are as the files spell them, e.g. Name_server. */
export interface GameFolderCheck {
  dir: string
  exists: boolean
  /** spells_us.txt: needed for spell timers. */
  spells: boolean
  logs: string[]
  inventory: string[]
  achievements: string[]
  factions: string[]
}

export interface MoteStock {
  /** Motes on hand, by rank key ("major": 60). */
  counts: Partial<Record<string, number>>
  /** The item being planned. */
  item: { name: string; lvl: number; xp: number; to: number }
  /** Add motes to the stock as they are looted. */
  autoAdd: boolean
  /** The time of the last loot line counted into the stock, so a mote is never added twice … */
  seenUntil?: number
  /** … and how many loot lines in that second were counted (a reward chest logs several at once). */
  seenAtSecond?: number
}
