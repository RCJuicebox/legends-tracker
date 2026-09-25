import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseCrafted, parseSkillPage, recipeIndex, type Recipe } from '../core/tradeskills'
import { field } from '../core/wikiItem'
import { log } from './log'

// Every recipe on eqlwiki.com, for the Tradeskills page: each page in the Player Crafted category
// carries its recipe and yield, fifty pages a request (about 45 requests), one at a time. Alchemy's
// table adds the potions whose own pages give no recipe (Elixir of Greater Concentration). Kept in
// the app's data and refreshed at most once a week, like the item catalog.
const API = 'https://eqlwiki.com/api.php'
const AGENT = 'LegendsTracker (https://github.com/RCJuicebox/legends-tracker)'
const FRESH_MS = 7 * 24 * 3600_000
const TIMEOUT_MS = 15_000
const FORMAT = 1

export type BookRecipe = Recipe & { icon: number }

export interface RecipeFile {
  fetchedAt: number
  format: number
  recipes: BookRecipe[]
}

export interface RecipeProgress {
  busy: boolean
  pages: number
  total: number
  error: string
}

export class RecipeBook {
  private file: RecipeFile | null = null
  private running: Promise<RecipeFile | null> | null = null
  progress: RecipeProgress = { busy: false, pages: 0, total: 0, error: '' }

  constructor(private readonly onProgress: (p: RecipeProgress) => void) {}

  private get path(): string {
    return join(app.getPath('userData'), 'tradeskill-recipes.json')
  }

  async stored(): Promise<RecipeFile | null> {
    if (this.file) return this.file
    try {
      this.file = JSON.parse(await fs.readFile(this.path, 'utf8')) as RecipeFile
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('The stored recipes could not be read', e)
      this.file = null
    }
    return this.file
  }

  isStale(file: RecipeFile | null): boolean {
    return !file || file.format < FORMAT || Date.now() - file.fetchedAt > FRESH_MS
  }

  refresh(): Promise<RecipeFile | null> {
    this.running ??= this.download().finally(() => (this.running = null))
    return this.running
  }

  private report(p: Partial<RecipeProgress>): void {
    this.progress = { ...this.progress, ...p }
    this.onProgress(this.progress)
  }

  private async download(): Promise<RecipeFile | null> {
    this.report({ busy: true, pages: 0, total: 0, error: '' })
    try {
      const info = (await this.get(`${API}?action=query&format=json&formatversion=2&prop=categoryinfo&titles=Category:Player_Crafted`)) as {
        query?: { pages?: { categoryinfo?: { pages: number } }[] }
      }
      this.report({ total: (info.query?.pages?.[0]?.categoryinfo?.pages ?? 2200) + 1 })
      const fromPages: BookRecipe[] = []
      let cont: Record<string, string> = {}
      let pages = 0
      for (;;) {
        const params = new URLSearchParams({
          action: 'query',
          format: 'json',
          formatversion: '2',
          generator: 'categorymembers',
          gcmtitle: 'Category:Player Crafted',
          gcmlimit: '50',
          gcmnamespace: '0',
          prop: 'revisions',
          rvprop: 'content',
          rvslots: 'main',
          ...cont
        })
        const body = (await this.get(`${API}?${params}`)) as {
          query?: { pages?: { title: string; revisions?: { slots: { main: { content: string } } }[] }[] }
          continue?: Record<string, string>
        }
        for (const p of body.query?.pages ?? []) {
          const content = p.revisions?.[0]?.slots.main.content
          if (!content) continue
          const icon = Number(field(content, 'lucy_img_ID')) || 0
          for (const r of parseCrafted(p.title, content)) fromPages.push({ ...r, icon })
        }
        pages += body.query?.pages?.length ?? 0
        this.report({ pages })
        if (!body.continue) break
        cont = body.continue
        // One request at a time, with a breath between: this is a volunteer-run wiki.
        await new Promise((r) => setTimeout(r, 150))
      }
      // Recipes a product's own page leaves out, from the Alchemy table. The other tradeskill pages'
      // tables are laid out too differently to read reliably, and their products have pages.
      const known = new Set(fromPages.map((r) => r.product.toLowerCase()))
      let fromTable: BookRecipe[] = []
      try {
        const t = (await this.get(`${API}?action=parse&format=json&formatversion=2&prop=wikitext&page=Skill_Alchemy`)) as { parse?: { wikitext?: string } }
        fromTable = parseSkillPage('Skill Alchemy', t.parse?.wikitext ?? '')
          .filter((r) => !known.has(r.product.toLowerCase()))
          .map((r) => ({ ...r, icon: 0 }))
      } catch (e) {
        log.warn('Could not read the Alchemy recipes table', e)
      }
      this.report({ pages: pages + 1 })
      const recipes = recipeIndex([fromPages, fromTable]) as BookRecipe[]
      const file: RecipeFile = { fetchedAt: Date.now(), format: FORMAT, recipes }
      await fs.writeFile(this.path + '.tmp', JSON.stringify(file), 'utf8')
      await fs.rename(this.path + '.tmp', this.path)
      this.file = file
      this.report({ busy: false })
      return file
    } catch (e) {
      log.warn('Recipe download failed', e)
      this.report({ busy: false, error: (e as Error).message })
      return this.file
    }
  }

  private async get(url: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { 'User-Agent': AGENT, 'Api-User-Agent': AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res.ok) return res.json()
      if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
        continue
      }
      throw new Error(`eqlwiki answered ${res.status}`)
    }
  }
}
