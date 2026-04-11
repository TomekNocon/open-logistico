import { generateObject } from 'ai'
import { z } from 'zod'
import { getParserModel } from './aiProvider'

export interface BLData {
  blNumber: string
  shipper: string
  consignee: string
  portOfLoading: string
  portOfDischarge: string
  vessel: string
  containers: string[]
  grossWeightKg: number
  packageCount: number
  goodsDescription: string
  shippedOnBoardDate: string
}

export interface InvoiceLineItem {
  description: string
  containerNumber: string
  vin?: string
  engineNumber?: string
  quantity: number
  unitPriceUsd: number
  totalValueUsd: number
}

export interface InvoiceData {
  invoiceNumber: string
  invoiceDate: string
  seller: string
  buyer: string
  tradeTerms: string
  currency: string
  lineItems: InvoiceLineItem[]
  totalValueUsd: number
  grossWeightKg?: number
}

export interface PackingListLineItem {
  description: string
  containerNumber: string
  vin?: string
  quantity: number
  grossWeightKg: number
  netWeightKg?: number
  cbm?: number
}

export interface PackingListData {
  seller: string
  buyer: string
  invoiceReference: string
  lineItems: PackingListLineItem[]
  totalQuantity: number
  totalGrossWeightKg: number
  totalCbm?: number
}

const blSchema = z.object({
  blNumber: z.string().describe('Bill of Lading number'),
  shipper: z.string().describe('Shipper/exporter name and location'),
  consignee: z.string().describe('Consignee/buyer name and address'),
  portOfLoading: z.string().describe('Port of loading'),
  portOfDischarge: z.string().describe('Port of discharge'),
  vessel: z.string().describe('Vessel name and voyage number'),
  containers: z.array(z.string()).describe('List of container numbers'),
  grossWeightKg: z.number().describe('Total gross weight in kg'),
  packageCount: z.number().describe('Total number of packages/units'),
  goodsDescription: z.string().describe('General description of goods'),
  shippedOnBoardDate: z.string().describe('Shipped on board date'),
})

const invoiceLineItemSchema = z.object({
  description: z.string().describe('Product description'),
  containerNumber: z.string().describe('Container number this item is in'),
  vin: z.string().optional().describe('Vehicle Identification Number if applicable'),
  engineNumber: z.string().optional().describe('Engine number if applicable'),
  quantity: z.number().describe('Quantity of items'),
  unitPriceUsd: z.number().describe('Unit price in USD'),
  totalValueUsd: z.number().describe('Total value in USD'),
})

const invoiceSchema = z.object({
  invoiceNumber: z.string().describe('Invoice number'),
  invoiceDate: z.string().describe('Invoice date'),
  seller: z.string().describe('Seller/exporter name'),
  buyer: z.string().describe('Buyer/importer name and address'),
  tradeTerms: z.string().describe('Trade terms e.g. FOB, CIF, DAP'),
  currency: z.string().describe('Currency code e.g. USD'),
  lineItems: z.array(invoiceLineItemSchema).describe('List of goods line items'),
  totalValueUsd: z.number().describe('Total invoice value in USD'),
  grossWeightKg: z.number().optional().describe('Gross weight in kg if stated'),
})

const packingListLineItemSchema = z.object({
  description: z.string().describe('Product description'),
  containerNumber: z.string().describe('Container number'),
  vin: z.string().optional().describe('VIN if applicable'),
  quantity: z.number().describe('Quantity'),
  grossWeightKg: z.number().describe('Gross weight in kg'),
  netWeightKg: z.number().optional().describe('Net weight in kg'),
  cbm: z.number().optional().describe('Volume in cubic meters'),
})

const packingListSchema = z.object({
  seller: z.string().describe('Seller name'),
  buyer: z.string().describe('Buyer name and address'),
  invoiceReference: z.string().describe('Related invoice number'),
  lineItems: z.array(packingListLineItemSchema).describe('List of packed items'),
  totalQuantity: z.number().describe('Total number of items'),
  totalGrossWeightKg: z.number().describe('Total gross weight in kg'),
  totalCbm: z.number().optional().describe('Total volume in CBM'),
})

export async function parseBillOfLading(pdfBytes: Buffer): Promise<BLData> {
  const { object } = await generateObject({
    model: getParserModel(),
    schema: blSchema,
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
            text: 'Extract all structured data from this Bill of Lading document. Return numeric values as numbers, not strings. For gross weight, convert to kg if given in tonnes (multiply by 1000).',
          },
        ],
      },
    ],
  })
  return object as BLData
}

export async function parseCommercialInvoice(pdfBytes: Buffer): Promise<InvoiceData> {
  const { object } = await generateObject({
    model: getParserModel(),
    schema: invoiceSchema,
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
            text: 'Extract all structured data from this Commercial Invoice document. Return all monetary values as numbers. Extract each line item separately with its container, VIN, engine number, unit price, quantity and total value.',
          },
        ],
      },
    ],
  })
  return object as InvoiceData
}

export async function parsePackingList(pdfBytes: Buffer): Promise<PackingListData> {
  const { object } = await generateObject({
    model: getParserModel(),
    schema: packingListSchema,
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
            text: 'Extract all structured data from this Packing List document. Return weight values as numbers in kg. Extract each line item separately.',
          },
        ],
      },
    ],
  })
  return object as PackingListData
}
