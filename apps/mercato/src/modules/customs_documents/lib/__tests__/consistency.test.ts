import { buildConsistencyTable, checkConsistency } from '../consistency'
import type { InvoiceData, PackingListData } from '../parser'

describe('customs_documents consistency', () => {
  it('computes invoice quantities numerically even when values are string-backed', () => {
    const invoice = {
      invoiceNumber: 'INV-001',
      invoiceDate: '2026-04-11',
      seller: 'Oceanic Export',
      buyer: 'Airlane Import',
      tradeTerms: 'FOB',
      currency: 'USD',
      totalValueUsd: '3000' as unknown as number,
      lineItems: [
        {
          description: 'Container A',
          containerNumber: 'ABCU1234567',
          quantity: '2' as unknown as number,
          unitPriceUsd: '1000' as unknown as number,
          totalValueUsd: '2000' as unknown as number,
        },
        {
          description: 'Container B',
          containerNumber: 'ABCU7654321',
          quantity: '1' as unknown as number,
          unitPriceUsd: '1000' as unknown as number,
          totalValueUsd: '1000' as unknown as number,
        },
      ],
    } as InvoiceData

    const packingList = {
      seller: 'Oceanic Export',
      buyer: 'Airlane Import',
      invoiceReference: 'INV-001',
      totalQuantity: '3' as unknown as number,
      totalGrossWeightKg: '500' as unknown as number,
      lineItems: [
        {
          description: 'Container A',
          containerNumber: 'ABCU1234567',
          quantity: 2,
          grossWeightKg: 300,
        },
        {
          description: 'Container B',
          containerNumber: 'ABCU7654321',
          quantity: 1,
          grossWeightKg: 200,
        },
      ],
    } as PackingListData

    const discrepancies = checkConsistency(null, invoice, packingList)
    const quantityMismatch = discrepancies.find((entry) => entry.fieldName === 'total_quantity')
    expect(quantityMismatch).toBeUndefined()

    const rows = buildConsistencyTable(null, invoice, packingList, discrepancies)
    const packageCountRow = rows.find((entry) => entry.fieldName === 'package_count')
    expect(packageCountRow?.invoiceValue).toBe('3')
  })
})
