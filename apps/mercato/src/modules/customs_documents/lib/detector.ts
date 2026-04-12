import { generateObject } from 'ai'
import { z } from 'zod'
import { getParserModel } from './aiProvider'

const detectionSchema = z.object({
  documentType: z.enum(['bl', 'invoice', 'packing_list']),
  confidence: z.enum(['high', 'medium', 'low']),
})

export type DocumentDetectionResult = {
  documentType: 'bl' | 'invoice' | 'packing_list'
  confidence: 'high' | 'medium' | 'low'
}

export function detectDocumentTypeFromFilename(
  fileName: string,
): DocumentDetectionResult | null {
  const lower = fileName.toLowerCase().replace(/\.[^.]+$/, '')
  if (lower.includes('invoice')) return { documentType: 'invoice', confidence: 'high' }
  if (lower.includes('pack')) return { documentType: 'packing_list', confidence: 'high' }
  if (lower.includes('bill') || lower.includes('lading') || lower.includes('awb') || /b[-_/]?l/.test(lower))
    return { documentType: 'bl', confidence: 'high' }
  return null
}

export async function detectDocumentTypeFromContent(
  pdfBytes: Buffer,
): Promise<DocumentDetectionResult> {
  const { object } = await generateObject({
    model: getParserModel(),
    schema: detectionSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            data: pdfBytes.toString('base64'),
            mediaType: 'application/pdf',
          },
          {
            type: 'text',
            text: `Classify this shipping document into exactly one of these types:
- "bl" (Bill of Lading): has B/L number, shipper, consignee, vessel name, port of loading/discharge, container numbers
- "invoice" (Commercial Invoice): has invoice number, seller, buyer, itemized goods with unit prices and total monetary values
- "packing_list" (Packing List): has itemized goods with weights (gross/net kg), dimensions, CBM — no prices

Return the document type and your confidence level.`,
          },
        ],
      },
    ],
  })
  return object
}

export async function detectDocumentType(
  pdfBytes: Buffer,
  fileName?: string,
): Promise<DocumentDetectionResult> {
  if (fileName) {
    const fromName = detectDocumentTypeFromFilename(fileName)
    if (fromName) return fromName
  }
  return detectDocumentTypeFromContent(pdfBytes)
}
