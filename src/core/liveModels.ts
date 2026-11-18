/**
 * Live EverQuest's newer ("Luclin") player-race models in EverQuest Legends, for anyone, with or without a
 * custom UI skin (Settings › UI). EQL ships Live's per-race model archives (globalhum_chr.s3d ...) but its
 * Resources/GlobalLoad.txt never loads them, and its client has none of Live's per-race UseLuclin options.
 * Adding a GlobalLoad.txt line per archive turns them on:
 *
 * - The client keeps the FIRST definition of a model tag it reads, so each race's lines go just before the
 *   line that loads the classic models (Global_chr, Iksar in Global4_chr).
 * - The flags' 4th letter T has the client load the archive's own animations (Live loads them TFFTC);
 *   copied from the classic TFFFC lines the models stand still in their rest pose.
 * - A race's <archive>2 (globalhum_chr2.s3d), where EQL ships one, holds more of its animations and goes
 *   right before it; the newer armour textures (LGEquip*, Global2_chr) go after the furniture line.
 * - EQL's own client loads GlobalFroglok_chr ahead of every phase-3 line, so Live's player Froglok
 *   (globalpcfroglok_chr) goes at the top, in phase 1.
 *
 * Nothing else in the game folder is touched, and every line added ends with MARK, so taking them out puts
 * the file back exactly. EQL's launcher puts GlobalLoad.txt back each time it starts the game, so the lines
 * are added again each time the game starts; the client reads them once a server is picked.
 */

/** Ends every line this adds. */
export const LIVE_MODELS_MARK = '(Legends Tracker)'
/** The same lines added by the script this came from; taken out too, so the two never load an archive twice. */
const OTHER_MARKS = ['(playermodels.py)']

/** The lines that load the classic player models, and the newer archive per race and gender. */
const RACES: { classic: string; models: [archive: string, race: string][] }[] = [
  {
    classic: 'Global_chr',
    models: [
      ['globalhum_chr', 'Human male'],
      ['globalhuf_chr', 'Human female'],
      ['globalbam_chr', 'Barbarian male'],
      ['globalbaf_chr', 'Barbarian female'],
      ['globalerm_chr', 'Erudite male'],
      ['globalerf_chr', 'Erudite female'],
      ['globalelm_chr', 'Wood Elf male'],
      ['globalelf_chr', 'Wood Elf female'],
      ['globalhim_chr', 'High Elf male'],
      ['globalhif_chr', 'High Elf female'],
      ['globaldam_chr', 'Dark Elf male'],
      ['globaldaf_chr', 'Dark Elf female'],
      ['globalham_chr', 'Half Elf male'],
      ['globalhaf_chr', 'Half Elf female'],
      ['globaldwm_chr', 'Dwarf male'],
      ['globaldwf_chr', 'Dwarf female'],
      ['globaltrm_chr', 'Troll male'],
      ['globaltrf_chr', 'Troll female'],
      ['globalogm_chr', 'Ogre male'],
      ['globalogf_chr', 'Ogre female'],
      ['globalhom_chr', 'Halfling male'],
      ['globalhof_chr', 'Halfling female'],
      ['globalgnm_chr', 'Gnome male'],
      ['globalgnf_chr', 'Gnome female']
    ]
  },
  {
    classic: 'Global4_chr',
    models: [
      ['globalikm_chr', 'Iksar male'],
      ['globalikf_chr', 'Iksar female']
    ]
  }
]
/** Loaded by the client itself before anything in phase 3: the newer one goes at the top of the file. */
const FROGLOK: [archive: string, race: string] = ['globalpcfroglok_chr', 'Froglok male and female']
const TOP_PHASE = '1,1,TFFTC'

/** The newer armour textures, after the line that loads this archive. */
const EQUIP_AFTER = 'it101084'
const EQUIP = ['1,1,TFFFC,LGEquip_amr2', '1,1,TFFFC,LGEquip_amr', '1,1,TFFFC,LGEquip2', '1,1,TFFFC,LGEquip', '4,0,TFFFC,Global2_chr']

/** Every archive name the lines may load, for checking which the game folder has (`<name>.s3d`). */
export function liveModelArchives(): string[] {
  const models = [...RACES.flatMap((g) => g.models.map(([a]) => a)), FROGLOK[0]]
  return [...models.flatMap((a) => [a, a + '2']), ...EQUIP.map((e) => e.split(',')[3]!)]
}

function isAdded(line: string): boolean {
  const t = line.trimEnd()
  return t.endsWith(LIVE_MODELS_MARK) || OTHER_MARKS.some((m) => t.endsWith(m))
}

const archiveOf = (line: string): string => (line.split(',')[3] ?? '').toLowerCase()

/** '3,1,TFFFC' -> '3,1,TFFTC': the 4th flag on, so the archive's own animations load. */
function withAnimations(phase: string): string {
  const i = phase.lastIndexOf(',')
  const flags = phase.slice(i + 1)
  return phase.slice(0, i + 1) + flags.slice(0, 3) + 'T' + flags.slice(4)
}

export interface LiveModelsEdit {
  text: string
  /** Race models now loaded (the Froglok archive counts once; the <archive>2 extras not at all). */
  models: number
  /** Lines this or the script took out first. */
  removed: number
  /** Why nothing could be added: the file has changed shape, or the game folder lacks the archives. */
  problem?: string
}

/** GlobalLoad.txt with every added line taken out: the file exactly as it was before. */
export function withoutLiveModels(text: string): LiveModelsEdit {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(eol)
  const kept = lines.filter((l) => !isAdded(l))
  return { text: kept.join(eol), models: 0, removed: lines.length - kept.length }
}

/**
 * GlobalLoad.txt with the newer player models loaded ahead of the classic ones. `has(archive)` says
 * whether the game folder has `<archive>.s3d`; a model the folder lacks is left out. Run on a file that
 * already has the lines, it gives the same file.
 */
export function withLiveModels(text: string, has: (archive: string) => boolean): LiveModelsEdit {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const before = withoutLiveModels(text)
  const lines = before.text.split(eol)
  const line = (phase: string, archive: string, what: string): string => `${phase},${archive},Loading Live ${what} ${LIVE_MODELS_MARK}`
  /** An archive and, where the folder has one, its <archive>2 just before it. */
  const pair = (phase: string, [archive, race]: [string, string]): string[] => [archive + '2', archive].filter(has).map((a) => line(phase, a, race))
  let models = 0
  const missing: string[] = []

  const equipAt = lines.findIndex((l) => archiveOf(l) === EQUIP_AFTER)
  if (equipAt >= 0) {
    const equip = EQUIP.filter((e) => has(e.split(',')[3]!)).map((e) => `${e},Loading Live armour ${LIVE_MODELS_MARK}`)
    lines.splice(equipAt + 1, 0, ...equip)
  }
  for (const group of RACES) {
    const at = lines.findIndex((l) => archiveOf(l) === group.classic.toLowerCase())
    if (at < 0) {
      missing.push(`no ${group.classic} line`)
      continue
    }
    const phase = withAnimations(lines[at]!.split(',').slice(0, 3).join(','))
    const present = group.models.filter(([a]) => has(a))
    lines.splice(at, 0, ...present.flatMap((m) => pair(phase, m)))
    models += present.length
  }
  if (has(FROGLOK[0])) {
    lines.splice(0, 0, ...pair(TOP_PHASE, FROGLOK))
    models += 2
  }
  if (!models)
    return { text, models: 0, removed: 0, problem: missing.length ? `GlobalLoad.txt has changed: ${missing.join(', ')}` : 'The game folder has none of the newer model archives.' }
  return { text: lines.join(eol), models, removed: before.removed }
}

/** What Settings › UI shows of the Live player models: the lines in the game's file now, and the last change. */
export interface LiveModelsStatus {
  /** Lines GlobalLoad.txt has now that load the newer models; 0 when the classic ones load. */
  lines: number
  /** The last time this session added or took them out. */
  last?: { at: number; ok: boolean; output: string }
  /** Why the file could not be read ('' when it could). */
  error: string
}

/** How many lines the file has from this or the script: 0 when the classic models load. */
export function liveModelLines(text: string): number {
  return text.split(/\r?\n/).filter(isAdded).length
}
