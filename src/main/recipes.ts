import { promises as fs } from 'node:fs'
import { writeFileAtomic } from './storeCore'
import { join } from 'node:path'
import { parseCrafted, parseSkillPage, recipeIndex } from '../core/tradeskills'
import { field } from '../core/wikiItem'
import { log } from './log'
import { wiki } from './sources/wiki'
import type { BookRecipe, RecipeFile, WikiProgress } from '../shared/ipc'
import { cacheDir } from './paths'
import { sources } from './sources/registry'
import { jobs, type Job } from './sources/jobs'

// Every recipe on eqlwiki.com, for the Tradeskills page: each page in the Player Crafted category
// carries its recipe and yield, fifty pages a request (about 45 requests), one at a time. Alchemy's
// table adds the potions whose own pages give no recipe (Elixir of Greater Concentration). Kept in
// the app's data and refreshed at most once a week, like the item catalog.
const FRESH_MS = 7 * 24 * 3600_000
// 2: the era tag of every page read (products and their ingredients), for crafted items' eras.
const FORMAT = 2
const ERA_TAG = /\{\{\s*([A-Za-z][A-Za-z ]*?)\s+Era\s*\}\}/

export type { BookRecipe, RecipeFile }
export type RecipeProgress = WikiProgress

export class RecipeBook {
  private file: RecipeFile | null = null
  private running: Promise<RecipeFile | null> | null = null
  progress: RecipeProgress = { busy: false, pages: 0, total: 0, error: '' }
  private job: Job | null = null

  constructor(private readonly onProgress: (p: RecipeProgress) => void) {}

  private get path(): string {
    return join(cacheDir(), 'tradeskill-recipes.json')
  }

  async stored(): Promise<RecipeFile | null> {
    if (this.file) return this.file
    try {
      this.file = JSON.parse(await fs.readFile(this.path, 'utf8')) as RecipeFile
      this.report({})
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') sources.fail('recipes', e)
      else sources.missing('recipes', 'Not downloaded yet: the Tradeskills page fetches them.')
      this.file = null
    }
    return this.file
  }

  isStale(file: RecipeFile | null): boolean {
    return !file || file.format < FORMAT || Date.now() - file.fetchedAt > FRESH_MS
  }

  refresh(): Promise<RecipeFile | null> {
    this.running ??= jobs.run('recipes', 'Downloading the recipes from eqlwiki', (job) => this.download(job)).finally(() => (this.running = null))
    return this.running
  }

  private report(p: Partial<RecipeProgress>): void {
    this.progress = { ...this.progress, ...p }
    this.onProgress(this.progress)
    if (this.progress.busy)
      this.job?.progress(this.progress.total ? this.progress.pages / this.progress.total : null, `${this.progress.pages} of ${this.progress.total || '?'} pages`)
    const file = this.file
    if (this.progress.busy) sources.reading('recipes', `${this.progress.pages} of ${this.progress.total || '?'} pages`)
    else if (this.progress.error) sources.fail('recipes', new Error(this.progress.error))
    else if (file) {
      const what = `${file.recipes.length.toLocaleString()} recipes, from ${new Date(file.fetchedAt).toLocaleDateString()}`
      if (this.isStale(file)) sources.stale('recipes', what)
      else sources.ok('recipes', what)
    }
  }

  /**
   * The era tag of every ingredient page not read already, fifty titles a request, following the
   * wiki's redirects: an ingredient out of era (a mold from the Epics era) puts what it makes out of era.
   */
  private async ingredientEras(recipes: BookRecipe[], eras: Record<string, string>): Promise<void> {
    const known = new Set(Object.keys(eras).map((t) => t.toLowerCase()))
    const names = [...new Set(recipes.flatMap((r) => r.ingredients.map((i) => i.name)))].filter((n) => !known.has(n.toLowerCase()))
    this.report({ total: this.progress.pages + Math.ceil(names.length / 50) })
    for (let i = 0; i < names.length; i += 50) {
      const batch = names.slice(i, i + 50)
      try {
        const pages = await wiki.pages(batch, 'background', this.job?.signal)
        for (const n of batch) eras[n] = ERA_TAG.exec(pages.get(n)?.content ?? '')?.[1] ?? ''
      } catch (e) {
        log.warn('Could not read the eras of some recipe ingredients', e)
      }
      this.report({ pages: this.progress.pages + 1 })
    }
  }

  private async download(job: Job): Promise<RecipeFile | null> {
    this.job = job
    this.report({ busy: true, pages: 0, total: 0, error: '' })
    try {
      this.report({ total: ((await wiki.categorySize('Player Crafted')) ?? 2200) + 1 })
      const fromPages: BookRecipe[] = []
      const eras: Record<string, string> = {}
      let pages = 0
      await wiki.category(
        'Player Crafted',
        (batch) => {
          for (const p of batch) {
            const icon = Number(field(p.content, 'lucy_img_ID')) || 0
            eras[p.title] = ERA_TAG.exec(p.content)?.[1] ?? ''
            for (const r of parseCrafted(p.title, p.content)) fromPages.push({ ...r, icon })
          }
          pages += batch.length
          this.report({ pages })
        },
        'background',
        job.signal
      )
      // Recipes a product's own page leaves out, from the Alchemy table. The other tradeskill pages'
      // tables are laid out too differently to read reliably, and their products have pages.
      const known = new Set(fromPages.map((r) => r.product.toLowerCase()))
      let fromTable: BookRecipe[] = []
      try {
        fromTable = parseSkillPage('Skill Alchemy', (await wiki.wikitext('Skill Alchemy', 'background')) ?? '')
          .filter((r) => !known.has(r.product.toLowerCase()))
          .map((r) => ({ ...r, icon: 0 }))
      } catch (e) {
        log.warn('Could not read the Alchemy recipes table', e)
      }
      this.report({ pages: pages + 1 })
      const recipes = recipeIndex([fromPages, fromTable]) as BookRecipe[]
      await this.ingredientEras(recipes, eras)
      const file: RecipeFile = { fetchedAt: Date.now(), format: FORMAT, recipes, eras }
      await writeFileAtomic(this.path, JSON.stringify(file))
      this.file = file
      this.report({ busy: false })
      return file
    } catch (e) {
      // Cancelled: the recipes kept before stay, and nothing failed.
      if (job.signal.aborted) this.report({ busy: false, error: '' })
      else {
        log.warn('Recipe download failed', e)
        this.report({ busy: false, error: (e as Error).message })
      }
      return this.file
    }
  }
}
