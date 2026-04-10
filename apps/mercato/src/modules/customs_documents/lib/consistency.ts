import type { BLData, InvoiceData, PackingListData } from './parser'

export interface Discrepancy {
  fieldName: string
  sourceA: string
  valueA: string
  sourceB: string
  valueB: string
  severity: 'error' | 'warning'
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (na === nb) return true
  // One contains the other
  if (na.includes(nb) || nb.includes(na)) return true
  // Share at least one significant word (3+ chars)
  const wordsA = na.split(' ').filter(w => w.length >= 3)
  const wordsB = new Set(nb.split(' ').filter(w => w.length >= 3))
  return wordsA.some(w => wordsB.has(w))
}

export function checkConsistency(
  bl: BLData | null,
  invoice: InvoiceData | null,
  packingList: PackingListData | null,
): Discrepancy[] {
  const discrepancies: Discrepancy[] = []

  // BL vs Packing List: gross weight (critical)
  if (bl && packingList) {
    if (bl.grossWeightKg !== packingList.totalGrossWeightKg) {
      discrepancies.push({
        fieldName: 'gross_weight_total',
        sourceA: 'bl',
        valueA: `${bl.grossWeightKg} kg`,
        sourceB: 'packing_list',
        valueB: `${packingList.totalGrossWeightKg} kg`,
        severity: 'error',
      })
    }

    // BL vs PL: package count
    if (bl.packageCount !== packingList.totalQuantity) {
      discrepancies.push({
        fieldName: 'package_count',
        sourceA: 'bl',
        valueA: String(bl.packageCount),
        sourceB: 'packing_list',
        valueB: String(packingList.totalQuantity),
        severity: 'error',
      })
    }
  }

  // BL vs Invoice: shipper name (warning)
  if (bl && invoice) {
    if (!namesMatch(bl.shipper, invoice.seller)) {
      discrepancies.push({
        fieldName: 'shipper_name',
        sourceA: 'bl',
        valueA: bl.shipper,
        sourceB: 'invoice',
        valueB: invoice.seller,
        severity: 'warning',
      })
    }

    // BL vs Invoice: consignee/buyer name (warning)
    if (!namesMatch(bl.consignee, invoice.buyer)) {
      discrepancies.push({
        fieldName: 'buyer_name',
        sourceA: 'bl',
        valueA: bl.consignee,
        sourceB: 'invoice',
        valueB: invoice.buyer,
        severity: 'warning',
      })
    }
  }

  // Invoice vs Packing List: line item count (error)
  if (invoice && packingList) {
    if (invoice.lineItems.length !== packingList.lineItems.length) {
      discrepancies.push({
        fieldName: 'line_item_count',
        sourceA: 'invoice',
        valueA: String(invoice.lineItems.length),
        sourceB: 'packing_list',
        valueB: String(packingList.lineItems.length),
        severity: 'error',
      })
    }

    // Invoice vs PL: total quantity
    const invoiceQty = invoice.lineItems.reduce((sum, i) => sum + i.quantity, 0)
    if (invoiceQty !== packingList.totalQuantity) {
      discrepancies.push({
        fieldName: 'total_quantity',
        sourceA: 'invoice',
        valueA: String(invoiceQty),
        sourceB: 'packing_list',
        valueB: String(packingList.totalQuantity),
        severity: 'error',
      })
    }
  }

  return discrepancies
}

export interface ConsistencyCheckRow {
  fieldName: string
  fieldLabel: string
  blValue: string | null
  invoiceValue: string | null
  packingListValue: string | null
  status: 'ok' | 'error' | 'warning'
  discrepancy?: Discrepancy
}

export function buildConsistencyTable(
  bl: BLData | null,
  invoice: InvoiceData | null,
  packingList: PackingListData | null,
  discrepancies: Discrepancy[],
): ConsistencyCheckRow[] {
  const discrepancyMap = new Map(discrepancies.map(d => [d.fieldName, d]))

  const rows: ConsistencyCheckRow[] = [
    {
      fieldName: 'gross_weight_total',
      fieldLabel: 'Gross Weight (total)',
      blValue: bl ? `${bl.grossWeightKg.toLocaleString()} kg` : null,
      invoiceValue: invoice?.grossWeightKg ? `${invoice.grossWeightKg.toLocaleString()} kg` : null,
      packingListValue: packingList ? `${packingList.totalGrossWeightKg.toLocaleString()} kg` : null,
      status: discrepancyMap.has('gross_weight_total')
        ? (discrepancyMap.get('gross_weight_total')!.severity as 'error' | 'warning')
        : 'ok',
      discrepancy: discrepancyMap.get('gross_weight_total'),
    },
    {
      fieldName: 'package_count',
      fieldLabel: 'Package Count',
      blValue: bl ? String(bl.packageCount) : null,
      invoiceValue: invoice ? String(invoice.lineItems.reduce((s, i) => s + i.quantity, 0)) : null,
      packingListValue: packingList ? String(packingList.totalQuantity) : null,
      status: discrepancyMap.has('package_count') ? 'error' : 'ok',
      discrepancy: discrepancyMap.get('package_count'),
    },
    {
      fieldName: 'shipper_name',
      fieldLabel: 'Shipper / Seller',
      blValue: bl?.shipper ?? null,
      invoiceValue: invoice?.seller ?? null,
      packingListValue: packingList?.seller ?? null,
      status: discrepancyMap.has('shipper_name') ? 'warning' : 'ok',
      discrepancy: discrepancyMap.get('shipper_name'),
    },
    {
      fieldName: 'buyer_name',
      fieldLabel: 'Consignee / Buyer',
      blValue: bl?.consignee ?? null,
      invoiceValue: invoice?.buyer ?? null,
      packingListValue: packingList?.buyer ?? null,
      status: discrepancyMap.has('buyer_name') ? 'warning' : 'ok',
      discrepancy: discrepancyMap.get('buyer_name'),
    },
    {
      fieldName: 'line_item_count',
      fieldLabel: 'Line Item Count',
      blValue: null,
      invoiceValue: invoice ? String(invoice.lineItems.length) : null,
      packingListValue: packingList ? String(packingList.lineItems.length) : null,
      status: discrepancyMap.has('line_item_count') ? 'error' : 'ok',
      discrepancy: discrepancyMap.get('line_item_count'),
    },
    {
      fieldName: 'port_of_loading',
      fieldLabel: 'Port of Loading',
      blValue: bl?.portOfLoading ?? null,
      invoiceValue: null,
      packingListValue: null,
      status: 'ok',
    },
    {
      fieldName: 'port_of_discharge',
      fieldLabel: 'Port of Discharge',
      blValue: bl?.portOfDischarge ?? null,
      invoiceValue: null,
      packingListValue: null,
      status: 'ok',
    },
    {
      fieldName: 'total_value',
      fieldLabel: 'Total Invoice Value',
      blValue: null,
      invoiceValue: invoice ? `${invoice.currency} ${invoice.totalValueUsd.toLocaleString()}` : null,
      packingListValue: null,
      status: 'ok',
    },
  ]

  return rows
}
