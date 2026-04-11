import { generateObject } from 'ai'
import { z } from 'zod'
import { getParserModel } from './aiProvider'

const ISZTAR4_BASE = 'https://ext-isztar4.mf.gov.pl/tariff/rest'

export interface TariffMeasure {
  country: string
  description: string
  dutyAmount: string
}

export interface HsProposal {
  code: string
  description: string
  dutyAmount: string
  tariffMeasures: TariffMeasure[]
  nonTariffMeasures: string[]
  confidence: 'high' | 'medium' | 'low'
}

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

function isztarSimulationDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find(p => p.type === 'year')?.value
  const m = parts.find(p => p.type === 'month')?.value
  const d = parts.find(p => p.type === 'day')?.value
  if (!y || !m || !d) {
    const now = new Date()
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
  }
  return `${y}-${m}-${d}`
}

function pageForHsChapter(chapter2: number): number | null {
  const row = CHAPTER_PAGE_RANGES.find(r => chapter2 >= r.minChapter && chapter2 <= r.maxChapter)
  return row?.page ?? null
}

function normalizeTenDigitCode(raw: string): string {
  return raw.replace(/\D/g, '').padEnd(10, '0').slice(0, 10)
}

function extractTenDigitLeaves(node: unknown): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    if (typeof o.code === 'string' && /^[0-9]{10}$/.test(o.code)) {
      out.push(o.code)
    }
    const sg = o.subgroup
    if (Array.isArray(sg)) {
      for (const x of sg) walk(x)
    }
  }
  walk(node)
  return out
}

function bestMatchingLeaf(suggested: string, leaves: string[], chapterPrefix: string, minCommonPrefix: number): string | null {
  const filtered = leaves.filter(c => c.startsWith(chapterPrefix))
  if (!filtered.length) return null

  let best: string | null = null
  let bestPrefix = -1
  let bestDist = Infinity
  const suggestedNum = parseInt(suggested, 10)

  for (const c of filtered) {
    let pl = 0
    while (pl < 10 && suggested[pl] === c[pl]) pl++
    const dist = Math.abs(suggestedNum - parseInt(c, 10))
    if (pl > bestPrefix || (pl === bestPrefix && dist < bestDist)) {
      best = c
      bestPrefix = pl
      bestDist = dist
    }
  }

  if (best === null || bestPrefix < minCommonPrefix) return null
  return best
}

const hsCodeSuggestionsSchema = z.object({
  codes: z.array(z.object({
    code: z.string().describe('10-digit HS/CN code, padded with zeros if needed'),
    confidence: z.enum(['high', 'medium', 'low']).describe('Confidence level of this suggestion'),
    rationale: z.string().describe('Brief reason why this code fits'),
  })).describe('Suggested HS codes ordered by likelihood, between 1 and 6 items'),
})

async function suggestHsCodes(description: string): Promise<Array<{ code: string; confidence: 'high' | 'medium' | 'low'; rationale: string }>> {
  const { object } = await generateObject({
    model: getParserModel(),
    schema: hsCodeSuggestionsSchema,
    system: `You are a customs classification expert specializing in EU Combined Nomenclature (CN) codes.
Given a product description, suggest the most likely 10-digit HS/CN codes.
Use your knowledge of the Harmonized System. Always return 10-digit codes padded with zeros (e.g. 8704221000).
Focus on EU import classifications.
Important: codes must be plausible 10-digit TARIC leaf codes (valid national subdivisions after the 6-digit HS subheading). Avoid invented trailing digits; prefer codes you are confident exist in the current EU TARIC.`,
    prompt: `Product description: ${description}\n\nSuggest the 3-5 most appropriate 10-digit HS/CN codes for EU import customs classification.`,
  })
  return object.codes
}

interface ParsedMeasures {
  description: string
  dutyAmount: string
  tariffMeasures: TariffMeasure[]
  nonTariffMeasures: string[]
}

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

async function resolveLeafViaNomenclatureTree(
  paddedCode: string,
  language: string,
  simulationDate: string,
  pageCache: Map<number, unknown>,
): Promise<string | null> {
  const chapter2 = parseInt(paddedCode.slice(0, 2), 10)
  if (!Number.isFinite(chapter2) || chapter2 < 1 || chapter2 > 99) return null

  const page = pageForHsChapter(chapter2)
  if (page === null) return null

  let tree = pageCache.get(page)
  if (tree === undefined) {
    tree = await fetchGoodsNomenclatureCodesPage(page, language, simulationDate)
    pageCache.set(page, tree)
  }
  if (!tree) return null

  const leaves = extractTenDigitLeaves(tree)
  const chapterPrefix = paddedCode.slice(0, 2)

  const resolved = bestMatchingLeaf(paddedCode, leaves, chapterPrefix, 5)
  if (resolved && resolved !== paddedCode) {
    return resolved
  }
  return null
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
    const data = await res.json() as {
      nomenclature?: { description?: string }
      tariffMeasures?: Array<{ country?: { description?: string }; description?: string; dutyAmount?: string }>
      nonTariffMeasures?: Array<{ description?: string }>
    }

    const ergoOmnes = (data.tariffMeasures ?? []).find(
      m => m.country?.description === 'ERGA OMNES' || m.description?.includes('Third country duty'),
    )

    return {
      description: data.nomenclature?.description ?? '',
      dutyAmount: ergoOmnes?.dutyAmount ?? (data.tariffMeasures?.[0]?.dutyAmount ?? '—'),
      tariffMeasures: (data.tariffMeasures ?? []).slice(0, 5).map(m => ({
        country: m.country?.description ?? '',
        description: m.description ?? '',
        dutyAmount: m.dutyAmount ?? '',
      })),
      nonTariffMeasures: (data.nonTariffMeasures ?? []).slice(0, 3).map(m => m.description ?? ''),
    }
  } catch (err) {
    console.warn(`[isztar4] fetchMeasures ${code} failed:`, err)
    return null
  }
}

async function fetchMeasuresWithTreeFallback(
  rawCode: string,
  language: string,
  simulationDate: string,
  pageCache: Map<number, unknown>,
): Promise<{ code: string; measures: ParsedMeasures } | null> {
  const padded = normalizeTenDigitCode(rawCode)
  let measures = await fetchMeasures(padded, language, simulationDate)
  if (measures) {
    return { code: padded, measures }
  }

  const resolved = await resolveLeafViaNomenclatureTree(padded, language, simulationDate, pageCache)
  if (!resolved) return null

  measures = await fetchMeasures(resolved, language, simulationDate)
  if (!measures) return null
  return { code: resolved, measures }
}

export async function searchHsCodes(description: string, language: 'PL' | 'EN' = 'EN'): Promise<HsProposal[]> {
  const suggestions = await suggestHsCodes(description)
  const proposals: HsProposal[] = []
  const simulationDate = isztarSimulationDate()
  const pageCache = new Map<number, unknown>()

  await Promise.allSettled(
    suggestions.map(async ({ code, confidence, rationale }) => {
      const paddedCode = normalizeTenDigitCode(code)
      const result = await fetchMeasuresWithTreeFallback(paddedCode, language, simulationDate, pageCache)

      proposals.push({
        code: result?.code ?? paddedCode,
        description: result?.measures.description || rationale || `HS Code ${result?.code ?? paddedCode}`,
        dutyAmount: result?.measures.dutyAmount ?? '—',
        tariffMeasures: result?.measures.tariffMeasures ?? [],
        nonTariffMeasures: result?.measures.nonTariffMeasures ?? [],
        confidence,
      })
    }),
  )

  proposals.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.confidence] - order[b.confidence]
  })

  return proposals
}
