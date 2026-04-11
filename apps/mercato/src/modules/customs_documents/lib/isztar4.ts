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
Use your knowledge of the Harmonized System. Always return 10-digit codes padded with zeros (e.g. 8704310010).
Focus on EU import classifications.`,
    prompt: `Product description: ${description}\n\nSuggest the 3-5 most appropriate 10-digit HS/CN codes for EU import customs classification.`,
  })
  return object.codes
}

async function fetchMeasures(code: string, language: string): Promise<{
  description: string
  dutyAmount: string
  tariffMeasures: TariffMeasure[]
  nonTariffMeasures: string[]
} | null> {
  try {
    const paddedCode = code.replace(/\D/g, '').padEnd(10, '0').slice(0, 10)
    const url = `${ISZTAR4_BASE}/goods-nomenclature/measures?nomenclatureCode=${paddedCode}&language=${language}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '(unreadable)')
      console.warn(`[isztar4] fetchMeasures ${paddedCode} → HTTP ${res.status}: ${errorBody}`)
      return null
    }
    const data = await res.json() as {
      nomenclature?: { description?: string }
      tariffMeasures?: Array<{ country?: { description?: string }; description?: string; dutyAmount?: string }>
      nonTariffMeasures?: Array<{ description?: string }>
    }

    console.log(`[isztar4] ${paddedCode} raw response:`, JSON.stringify(data).slice(0, 1000))

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

export async function searchHsCodes(description: string, language: 'PL' | 'EN' = 'EN'): Promise<HsProposal[]> {
  const suggestions = await suggestHsCodes(description)
  const proposals: HsProposal[] = []

  await Promise.allSettled(
    suggestions.map(async ({ code, confidence, rationale }) => {
      const paddedCode = code.replace(/\D/g, '').padEnd(10, '0').slice(0, 10)
      const measures = await fetchMeasures(paddedCode, language)

      proposals.push({
        code: paddedCode,
        description: measures?.description || rationale || `HS Code ${paddedCode}`,
        dutyAmount: measures?.dutyAmount ?? '—',
        tariffMeasures: measures?.tariffMeasures ?? [],
        nonTariffMeasures: measures?.nonTariffMeasures ?? [],
        confidence,
      })
    }),
  )

  // Sort: high confidence first
  proposals.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.confidence] - order[b.confidence]
  })

  return proposals
}
