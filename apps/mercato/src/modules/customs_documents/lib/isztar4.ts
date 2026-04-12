import { generateObject } from 'ai'
import { z } from 'zod'
import { getParserModel } from './aiProvider'
import { HS_CHAPTERS_PL, findChapterDescription } from './hsChapters'

const ISZTAR4_BASE = 'https://ext-isztar4.mf.gov.pl/tariff/rest'

// ISZTAR4 paginates the codes endpoint by HS chapter ranges. Hand-mapped so we
// only fetch the page(s) we need instead of crawling the whole tree.
const CHAPTER_PAGE_RANGES: Array<{ page: number; minChapter: number; maxChapter: number }> = [
  { page: 1, minChapter: 1, maxChapter: 5 },
  { page: 2, minChapter: 6, maxChapter: 14 },
  { page: 3, minChapter: 15, maxChapter: 15 },
  { page: 4, minChapter: 16, maxChapter: 24 },
  { page: 5, minChapter: 25, maxChapter: 27 },
  { page: 6, minChapter: 28, maxChapter: 38 },
  { page: 7, minChapter: 39, maxChapter: 40 },
  { page: 8, minChapter: 41, maxChapter: 43 },
  { page: 9, minChapter: 44, maxChapter: 46 },
  { page: 10, minChapter: 47, maxChapter: 49 },
  { page: 11, minChapter: 50, maxChapter: 63 },
  { page: 12, minChapter: 64, maxChapter: 67 },
  { page: 13, minChapter: 68, maxChapter: 70 },
  { page: 14, minChapter: 71, maxChapter: 71 },
  { page: 15, minChapter: 72, maxChapter: 83 },
  { page: 16, minChapter: 84, maxChapter: 85 },
  { page: 17, minChapter: 86, maxChapter: 89 },
  { page: 18, minChapter: 90, maxChapter: 92 },
  { page: 19, minChapter: 93, maxChapter: 93 },
  { page: 20, minChapter: 94, maxChapter: 96 },
  { page: 21, minChapter: 97, maxChapter: 99 },
]

export interface TariffMeasure {
  country: string
  description: string
  dutyAmount: string
}

export interface HsProposal {
  code: string
  description: string
  breadcrumb: string
  reasoning: string
  dutyAmount: string
  tariffMeasures: TariffMeasure[]
  nonTariffMeasures: string[]
  confidence: 'high' | 'medium' | 'low'
}

interface FlatLeaf {
  code: string
  description: string
  breadcrumb: string[]
}

// ─── Date / pagination helpers ─────────────────────────────────────────────────

function isztarSimulationDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  if (!y || !m || !d) {
    const now = new Date()
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
  }
  return `${y}-${m}-${d}`
}

function pageForHsChapter(chapter2: number): number | null {
  const row = CHAPTER_PAGE_RANGES.find((r) => chapter2 >= r.minChapter && chapter2 <= r.maxChapter)
  return row?.page ?? null
}

function normalizeTenDigitCode(raw: string): string {
  return raw.replace(/\D/g, '').padEnd(10, '0').slice(0, 10)
}

// ─── Tree walking ──────────────────────────────────────────────────────────────

function cleanLabel(raw: string | undefined): string {
  if (!raw) return ''
  return raw.replace(/^[-\s›]+/, '').trim()
}

function flattenTreeToLeaves(node: unknown, breadcrumb: string[] = []): FlatLeaf[] {
  const out: FlatLeaf[] = []
  const walk = (n: unknown, path: string[]): void => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    const label = typeof o.description === 'string' ? cleanLabel(o.description) : ''
    const isTenDigitLeaf = typeof o.code === 'string' && /^[0-9]{10}$/.test(o.code)
    if (isTenDigitLeaf) {
      out.push({
        code: o.code as string,
        description: label,
        breadcrumb: [...path],
      })
    }
    const sg = o.subgroup
    if (Array.isArray(sg)) {
      // Add this node's label to the breadcrumb when descending into children,
      // but only if it's a non-empty grouping label (not the leaf itself).
      const nextPath = label && !isTenDigitLeaf ? [...path, label] : path
      for (const child of sg) walk(child, nextPath)
    }
  }
  walk(node, breadcrumb)
  return out
}

function findCommonBreadcrumbPrefix(leaves: FlatLeaf[]): string[] {
  if (leaves.length === 0) return []
  if (leaves.length === 1) return [...leaves[0].breadcrumb]
  const minLen = Math.min(...leaves.map((l) => l.breadcrumb.length))
  const prefix: string[] = []
  for (let i = 0; i < minLen; i++) {
    const first = leaves[0].breadcrumb[i]
    if (leaves.every((l) => l.breadcrumb[i] === first)) prefix.push(first)
    else break
  }
  return prefix
}

function describeGroup(leaves: FlatLeaf[]): string {
  const common = findCommonBreadcrumbPrefix(leaves)
  return common[common.length - 1] ?? leaves[0]?.description ?? ''
}

// ─── ISZTAR4 fetching ──────────────────────────────────────────────────────────

async function fetchGoodsNomenclatureCodesPage(
  page: number,
  language: string,
  simulationDate: string,
): Promise<unknown> {
  const url = `${ISZTAR4_BASE}/goods-nomenclature/codes?language=${language}&simulationDate=${simulationDate}&page=${page}&size=50`
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn(`[isztar4] fetch codes page ${page} → HTTP ${res.status}: ${body.slice(0, 200)}`)
    return null
  }
  return res.json()
}

interface ParsedMeasures {
  description: string
  dutyAmount: string
  tariffMeasures: TariffMeasure[]
  nonTariffMeasures: string[]
}

async function fetchMeasures(
  code: string,
  language: string,
  simulationDate: string,
): Promise<ParsedMeasures | null> {
  try {
    const paddedCode = normalizeTenDigitCode(code)
    const url = `${ISZTAR4_BASE}/goods-nomenclature/measures?nomenclatureCode=${paddedCode}&language=${language}&simulationDate=${simulationDate}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '(unreadable)')
      console.warn(`[isztar4] fetchMeasures ${paddedCode} → HTTP ${res.status}: ${errorBody.slice(0, 400)}`)
      return null
    }
    const data = (await res.json()) as {
      nomenclature?: { description?: string }
      tariffMeasures?: Array<{ country?: { description?: string }; description?: string; dutyAmount?: string }>
      nonTariffMeasures?: Array<{ description?: string }>
    }

    const ergoOmnes = (data.tariffMeasures ?? []).find(
      (m) => m.country?.description === 'ERGA OMNES' || m.description?.includes('Third country duty'),
    )

    return {
      description: data.nomenclature?.description ?? '',
      dutyAmount: ergoOmnes?.dutyAmount ?? (data.tariffMeasures?.[0]?.dutyAmount ?? '—'),
      tariffMeasures: (data.tariffMeasures ?? []).slice(0, 5).map((m) => ({
        country: m.country?.description ?? '',
        description: m.description ?? '',
        dutyAmount: m.dutyAmount ?? '',
      })),
      nonTariffMeasures: (data.nonTariffMeasures ?? []).slice(0, 3).map((m) => m.description ?? ''),
    }
  } catch (err) {
    console.warn(`[isztar4] fetchMeasures ${code} failed:`, err)
    return null
  }
}

// ─── Generic LLM picker ────────────────────────────────────────────────────────

const pickResultSchema = z.object({
  picks: z
    .array(
      z.object({
        code: z.string().describe('Code chosen from the provided candidates list, exactly as given'),
        rationale: z.string().describe('One short Polish sentence explaining why this matches the product'),
        confidence: z.enum(['high', 'medium', 'low']).describe('How confident this is the right choice'),
      }),
    )
    .min(1),
})

type PickLevel = 'chapter' | 'heading' | 'subheading' | 'leaf'

const LEVEL_LABELS_PL: Record<PickLevel, string> = {
  chapter: 'dział (2-cyfrowy)',
  heading: 'pozycja taryfowa (4-cyfrowa)',
  subheading: 'podpozycja taryfowa (6-cyfrowa)',
  leaf: 'kod TARIC (10-cyfrowy, finalny)',
}

async function pickFromCandidates(
  productDescription: string,
  level: PickLevel,
  candidates: Array<{ code: string; description: string }>,
  maxPicks: number,
): Promise<Array<{ code: string; rationale: string; confidence: 'high' | 'medium' | 'low' }>> {
  if (candidates.length === 0) return []
  if (candidates.length === 1) {
    return [{ code: candidates[0].code, rationale: 'Jedyna dostępna opcja na tym poziomie', confidence: 'high' }]
  }

  // Sort by code so prompt content is deterministic regardless of input order.
  const sortedCandidates = [...candidates].sort((a, b) => a.code.localeCompare(b.code))
  const validCodes = new Set(sortedCandidates.map((c) => c.code))
  const candidateLines = sortedCandidates.map((c) => `${c.code} | ${c.description}`).join('\n')
  const levelLabel = LEVEL_LABELS_PL[level]

  const system = `Jesteś ekspertem klasyfikacji celnej towarów według nomenklatury HS / EU CN.
Otrzymasz opis produktu oraz listę kandydatów na poziomie: ${levelLabel}.
Twoje zadanie: wybrać do ${maxPicks} najbardziej prawdopodobnych kodów z dostarczonej listy, posortowanych od najbardziej do najmniej prawdopodobnego.
WAŻNE:
- Wybieraj WYŁĄCZNIE z dostarczonej listy. Nie wymyślaj kodów.
- Dla każdego wyboru podaj krótkie uzasadnienie po polsku (jedno zdanie).
- Określ pewność: high (jednoznaczny wybór), medium (sensowny ale nie jedyny), low (wątpliwy).
- Stosuj reguły GIR (General Rules of Interpretation), w szczególności GIR 1, 3 i 6.
- Części pojazdów, maszyn itp. zazwyczaj klasyfikuje się pod kodami części (chapter parts), nie pod materiałem.`

  const prompt = `Opis produktu:
${productDescription}

Kandydaci (${level}):
${candidateLines}

Wybierz do ${maxPicks} najlepszych kodów z powyższej listy.`

  try {
    const { object } = await generateObject({
      model: getParserModel(),
      temperature: 0,
      schema: pickResultSchema,
      system,
      prompt,
    })
    // Filter to codes that actually appear in the candidate list (defense against hallucination).
    const filtered = object.picks
      .filter((p) => validCodes.has(p.code))
      .slice(0, maxPicks)
    return filtered
  } catch (err) {
    console.warn(`[isztar4] pickFromCandidates(${level}) failed:`, err)
    return []
  }
}

// ─── Main entry point ──────────────────────────────────────────────────────────

export async function searchHsCodes(
  description: string,
  language: 'PL' | 'EN' = 'PL',
): Promise<HsProposal[]> {
  const simulationDate = isztarSimulationDate()
  const fetchLanguage = 'PL' // tree is always fetched in Polish for matching
  const pageCache = new Map<number, unknown>()

  // STEP 1: Pick top 3 chapters from the static list of 99
  const chapterPicksRaw = await pickFromCandidates(description, 'chapter', HS_CHAPTERS_PL, 3)
  if (chapterPicksRaw.length === 0) {
    console.warn('[isztar4] searchHsCodes: no chapters picked')
    return []
  }
  // Sort by code so downstream prompts are deterministic regardless of pick order.
  const chapterPicks = [...chapterPicksRaw].sort((a, b) => a.code.localeCompare(b.code))

  // STEP 2: Fetch the relevant ISZTAR4 pages and collect leaves per picked chapter
  const leavesByChapter = new Map<string, FlatLeaf[]>()
  await Promise.all(
    chapterPicks.map(async (pick) => {
      const chapterNum = parseInt(pick.code, 10)
      if (!Number.isFinite(chapterNum)) return
      const page = pageForHsChapter(chapterNum)
      if (page === null) return

      let tree = pageCache.get(page)
      if (tree === undefined) {
        tree = await fetchGoodsNomenclatureCodesPage(page, fetchLanguage, simulationDate)
        pageCache.set(page, tree ?? null)
      }
      if (!tree) return

      // Seed breadcrumb with the chapter description so leaves remember which chapter they came from.
      const chapterDesc = findChapterDescription(pick.code) ?? ''
      const initialPath = chapterDesc ? [chapterDesc] : []
      const allLeaves = flattenTreeToLeaves(tree, initialPath)
      const leavesForThisChapter = allLeaves.filter((l) => l.code.startsWith(pick.code))
      leavesByChapter.set(pick.code, leavesForThisChapter)
    }),
  )

  // STEP 3: For each picked chapter, pick the top 2 headings (4-digit prefix)
  const headingsToExplore: Array<{ chapter: string; headingCode: string }> = []
  await Promise.all(
    chapterPicks.map(async (chapterPick) => {
      const leaves = leavesByChapter.get(chapterPick.code) ?? []
      if (leaves.length === 0) return

      const headingMap = new Map<string, FlatLeaf[]>()
      for (const leaf of leaves) {
        const headingCode = leaf.code.slice(0, 4)
        const list = headingMap.get(headingCode) ?? []
        list.push(leaf)
        headingMap.set(headingCode, list)
      }

      const headingCandidates = Array.from(headingMap.entries()).map(([code, ls]) => ({
        code,
        description: describeGroup(ls),
      }))

      const headingPicks = await pickFromCandidates(description, 'heading', headingCandidates, 2)
      for (const hp of headingPicks) {
        headingsToExplore.push({ chapter: chapterPick.code, headingCode: hp.code })
      }
    }),
  )

  // Sort headings deterministically before downstream parallel processing.
  headingsToExplore.sort((a, b) => a.chapter.localeCompare(b.chapter) || a.headingCode.localeCompare(b.headingCode))

  // STEP 4: For each picked heading, pick the top 2 subheadings (6-digit prefix)
  const subheadingsToExplore: Array<{ chapter: string; subheadingCode: string }> = []
  await Promise.all(
    headingsToExplore.map(async (h) => {
      const leaves = (leavesByChapter.get(h.chapter) ?? []).filter((l) => l.code.startsWith(h.headingCode))
      if (leaves.length === 0) return

      const subMap = new Map<string, FlatLeaf[]>()
      for (const leaf of leaves) {
        const sh = leaf.code.slice(0, 6)
        const list = subMap.get(sh) ?? []
        list.push(leaf)
        subMap.set(sh, list)
      }

      const subCandidates = Array.from(subMap.entries()).map(([code, ls]) => ({
        code,
        description: describeGroup(ls),
      }))

      const subPicks = await pickFromCandidates(description, 'subheading', subCandidates, 2)
      for (const sp of subPicks) {
        subheadingsToExplore.push({ chapter: h.chapter, subheadingCode: sp.code })
      }
    }),
  )

  // Sort subheadings deterministically so the final leaf prompt is stable across runs.
  subheadingsToExplore.sort((a, b) => a.chapter.localeCompare(b.chapter) || a.subheadingCode.localeCompare(b.subheadingCode))

  // STEP 5: Final pick from all 10-digit leaves under picked subheadings
  const candidateLeaves: FlatLeaf[] = []
  const seenCodes = new Set<string>()
  for (const sh of subheadingsToExplore) {
    const leaves = (leavesByChapter.get(sh.chapter) ?? []).filter((l) => l.code.startsWith(sh.subheadingCode))
    for (const leaf of leaves) {
      if (!seenCodes.has(leaf.code)) {
        candidateLeaves.push(leaf)
        seenCodes.add(leaf.code)
      }
    }
  }
  // Final ordering by code so the leaf-pick prompt is byte-identical across runs.
  candidateLeaves.sort((a, b) => a.code.localeCompare(b.code))

  if (candidateLeaves.length === 0) {
    console.warn('[isztar4] searchHsCodes: no leaves under picked subheadings')
    return []
  }

  // Build the final candidate list with full breadcrumb so the LLM has disambiguation context.
  const finalCandidates = candidateLeaves.map((l) => ({
    code: l.code,
    description: l.breadcrumb.length > 0 ? `${l.breadcrumb.join(' › ')} › ${l.description}` : l.description,
  }))

  const finalPicks = await pickFromCandidates(description, 'leaf', finalCandidates, 5)
  if (finalPicks.length === 0) return []

  // STEP 6: Live /measures lookup for each final pick (in parallel)
  const codeToLeaf = new Map(candidateLeaves.map((l) => [l.code, l]))
  const proposals: HsProposal[] = await Promise.all(
    finalPicks.map(async (pick) => {
      const leaf = codeToLeaf.get(pick.code)
      const measures = await fetchMeasures(pick.code, language, simulationDate)
      const breadcrumbStr = leaf?.breadcrumb.join(' › ') ?? ''
      return {
        code: pick.code,
        description: leaf?.description || measures?.description || `HS Code ${pick.code}`,
        breadcrumb: breadcrumbStr,
        reasoning: pick.rationale,
        dutyAmount: measures?.dutyAmount ?? '—',
        tariffMeasures: measures?.tariffMeasures ?? [],
        nonTariffMeasures: measures?.nonTariffMeasures ?? [],
        confidence: pick.confidence,
      }
    }),
  )

  // Sort: high confidence first
  proposals.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.confidence] - order[b.confidence]
  })

  return proposals
}
