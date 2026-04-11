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

export async function detectDocumentType(pdfBytes: Buffer): Promise<DocumentDetectionResult> {
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
