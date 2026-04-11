import { toNullableFiniteNumber } from './numbers'

type NullableText = string | null | undefined
type NullableNumber = unknown

type DeclarationExportInput = {
  id: string
  status: string
  blNumber?: NullableText
  invoiceNumber?: NullableText
  shipperName?: NullableText
  consigneeName?: NullableText
  portOfLoading?: NullableText
  portOfDischarge?: NullableText
  grossWeightBl?: NullableNumber
  grossWeightPl?: NullableNumber
  packageCountBl?: NullableNumber
  packageCountPl?: NullableNumber
  totalValueUsd?: NullableNumber
  currency?: NullableText
}

type LineItemExportInput = {
  id: string
  description: string
  quantity?: NullableNumber
  unitPriceUsd?: NullableNumber
  totalValueUsd?: NullableNumber
  grossWeightKg?: NullableNumber
  netWeightKg?: NullableNumber
  containerNumber?: NullableText
  vin?: NullableText
  engineNumber?: NullableText
  hsCodeSelected?: NullableText
}

type DiscrepancyExportInput = {
  fieldName: string
  sourceA: string
  valueA: string
  sourceB: string
  valueB: string
  severity: 'error' | 'warning'
}

export type CustomsTransferTarget = 'winsad' | 'generic'
export type CustomsTransferFormat = 'json' | 'csv'

export type BuildCustomsTransferPayloadInput = {
  target: CustomsTransferTarget
  declaration: DeclarationExportInput
  lineItems: LineItemExportInput[]
  discrepancies: DiscrepancyExportInput[]
  generatedAt?: Date
}

function normalizeText(value: NullableText): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

function normalizeNumber(value: NullableNumber): number | null {
  return toNullableFiniteNumber(value)
}

function escapeCsv(value: string | number | null): string {
  if (value === null) return ''
  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) return `"${stringValue.replace(/"/g, '""')}"`
  return stringValue
}

function withFallback(value: string | null, fallback: string): string {
  return value ?? fallback
}

function buildSadAdditionalInformation(
  blNumber: string | null,
  invoiceNumber: string | null,
): string | null {
  const entries: string[] = []
  if (blNumber) entries.push(`B/L:${blNumber}`)
  if (invoiceNumber) entries.push(`Invoice:${invoiceNumber}`)
  return entries.length > 0 ? entries.join('; ') : null
}

export function buildCustomsTransferPayload(input: BuildCustomsTransferPayloadInput): Record<string, unknown> {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString()
  const declaration = input.declaration
  const lineItems = input.lineItems
  const discrepancies = input.discrepancies

  const discrepancyErrors = discrepancies.filter((d) => d.severity === 'error').length
  const discrepancyWarnings = discrepancies.filter((d) => d.severity === 'warning').length

  const normalizedBlNumber = normalizeText(declaration.blNumber)
  const normalizedInvoiceNumber = normalizeText(declaration.invoiceNumber)
  const normalizedShipperName = normalizeText(declaration.shipperName)
  const normalizedConsigneeName = normalizeText(declaration.consigneeName)
  const normalizedPortOfLoading = normalizeText(declaration.portOfLoading)
  const normalizedPortOfDischarge = normalizeText(declaration.portOfDischarge)
  const normalizedCurrency = withFallback(normalizeText(declaration.currency), 'USD')

  const normalizedGrossMass = normalizeNumber(declaration.grossWeightPl) ?? normalizeNumber(declaration.grossWeightBl)
  const normalizedPackageCount = normalizeNumber(declaration.packageCountPl) ?? normalizeNumber(declaration.packageCountBl)

  const base = {
    schema: 'open-mercato.customs-transfer.v1',
    generatedAt,
    target: input.target,
    declaration: {
      id: declaration.id,
      status: declaration.status,
      blNumber: normalizedBlNumber,
      invoiceNumber: normalizedInvoiceNumber,
      shipperName: normalizedShipperName,
      consigneeName: normalizedConsigneeName,
      portOfLoading: normalizedPortOfLoading,
      portOfDischarge: normalizedPortOfDischarge,
      currency: normalizedCurrency,
      totalValueUsd: normalizeNumber(declaration.totalValueUsd),
      grossWeightBlKg: normalizeNumber(declaration.grossWeightBl),
      grossWeightPlKg: normalizeNumber(declaration.grossWeightPl),
      packageCountBl: normalizeNumber(declaration.packageCountBl),
      packageCountPl: normalizeNumber(declaration.packageCountPl),
    },
    lineItems: lineItems.map((lineItem, index) => ({
      lineNo: index + 1,
      id: lineItem.id,
      description: lineItem.description,
      quantity: normalizeNumber(lineItem.quantity),
      unitPriceUsd: normalizeNumber(lineItem.unitPriceUsd),
      totalValueUsd: normalizeNumber(lineItem.totalValueUsd),
      grossWeightKg: normalizeNumber(lineItem.grossWeightKg),
      netWeightKg: normalizeNumber(lineItem.netWeightKg),
      containerNumber: normalizeText(lineItem.containerNumber),
      vin: normalizeText(lineItem.vin),
      engineNumber: normalizeText(lineItem.engineNumber),
      hsCodeSelected: normalizeText(lineItem.hsCodeSelected),
    })),
    validation: {
      discrepancyErrors,
      discrepancyWarnings,
      discrepancies: discrepancies.map((discrepancy) => ({
        fieldName: discrepancy.fieldName,
        sourceA: discrepancy.sourceA,
        valueA: discrepancy.valueA,
        sourceB: discrepancy.sourceB,
        valueB: discrepancy.valueB,
        severity: discrepancy.severity,
      })),
    },
  }

  if (input.target === 'generic') return base

  return {
    ...base,
    winsad: {
      sadHeader: {
        box2Exporter: normalizedShipperName,
        box8Consignee: normalizedConsigneeName,
        box29OfficeOfEntry: normalizedPortOfDischarge,
        box31Packages: normalizedPackageCount,
        box35GrossMassKg: normalizedGrossMass,
        box44AdditionalInformation: buildSadAdditionalInformation(normalizedBlNumber, normalizedInvoiceNumber),
      },
      sadItems: lineItems.map((lineItem, index) => ({
        lineNo: index + 1,
        box31PackagesAndDescription: lineItem.description,
        box33CommodityCode: normalizeText(lineItem.hsCodeSelected),
        box38NetMassKg: normalizeNumber(lineItem.netWeightKg),
        box42ItemPriceUsd: normalizeNumber(lineItem.totalValueUsd),
        box44AdditionalInformation: [normalizeText(lineItem.containerNumber), normalizeText(lineItem.vin), normalizeText(lineItem.engineNumber)]
          .filter((entry): entry is string => Boolean(entry))
          .join(' | ') || null,
      })),
    },
  }
}

export function buildCustomsTransferCsv(input: BuildCustomsTransferPayloadInput): string {
  const declaration = input.declaration
  const lineItems = input.lineItems
  const discrepancies = input.discrepancies

  const discrepancyErrors = discrepancies.filter((d) => d.severity === 'error').length
  const discrepancyWarnings = discrepancies.filter((d) => d.severity === 'warning').length

  const rows = lineItems.length > 0
    ? lineItems
    : [{
      id: '',
      description: '',
      quantity: null,
      unitPriceUsd: null,
      totalValueUsd: null,
      grossWeightKg: null,
      netWeightKg: null,
      containerNumber: null,
      vin: null,
      engineNumber: null,
      hsCodeSelected: null,
    }]

  const header = [
    'target',
    'declaration_id',
    'declaration_status',
    'invoice_number',
    'bl_number',
    'shipper_name',
    'consignee_name',
    'port_of_loading',
    'port_of_discharge',
    'currency',
    'declaration_total_value_usd',
    'declaration_gross_weight_kg',
    'declaration_package_count',
    'line_no',
    'line_item_id',
    'line_description',
    'line_quantity',
    'line_unit_price_usd',
    'line_total_value_usd',
    'line_gross_weight_kg',
    'line_net_weight_kg',
    'line_container_number',
    'line_vin',
    'line_engine_number',
    'line_hs_code_selected',
    'validation_errors',
    'validation_warnings',
    'winsad_box_2_exporter',
    'winsad_box_8_consignee',
    'winsad_box_31_packages',
    'winsad_box_33_commodity_code',
    'winsad_box_35_gross_mass_kg',
    'winsad_box_42_item_price_usd',
  ]

  const declarationGrossMass = normalizeNumber(declaration.grossWeightPl) ?? normalizeNumber(declaration.grossWeightBl)
  const declarationPackageCount = normalizeNumber(declaration.packageCountPl) ?? normalizeNumber(declaration.packageCountBl)

  const lines = [header.join(',')]
  rows.forEach((lineItem, index) => {
    const values: Array<string | number | null> = [
      input.target,
      declaration.id,
      declaration.status,
      normalizeText(declaration.invoiceNumber),
      normalizeText(declaration.blNumber),
      normalizeText(declaration.shipperName),
      normalizeText(declaration.consigneeName),
      normalizeText(declaration.portOfLoading),
      normalizeText(declaration.portOfDischarge),
      withFallback(normalizeText(declaration.currency), 'USD'),
      normalizeNumber(declaration.totalValueUsd),
      declarationGrossMass,
      declarationPackageCount,
      index + 1,
      lineItem.id,
      lineItem.description,
      normalizeNumber(lineItem.quantity),
      normalizeNumber(lineItem.unitPriceUsd),
      normalizeNumber(lineItem.totalValueUsd),
      normalizeNumber(lineItem.grossWeightKg),
      normalizeNumber(lineItem.netWeightKg),
      normalizeText(lineItem.containerNumber),
      normalizeText(lineItem.vin),
      normalizeText(lineItem.engineNumber),
      normalizeText(lineItem.hsCodeSelected),
      discrepancyErrors,
      discrepancyWarnings,
      normalizeText(declaration.shipperName),
      normalizeText(declaration.consigneeName),
      declarationPackageCount,
      normalizeText(lineItem.hsCodeSelected),
      declarationGrossMass,
      normalizeNumber(lineItem.totalValueUsd),
    ]
    lines.push(values.map((value) => escapeCsv(value)).join(','))
  })

  return lines.join('\n')
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export function buildCustomsTransferFileName(input: {
  declarationId: string
  target: CustomsTransferTarget
  format: CustomsTransferFormat
}): string {
  const declarationPart = sanitizeFilePart(input.declarationId)
  const extension = input.format === 'csv' ? 'csv' : 'json'
  return `customs-${input.target}-${declarationPart}.${extension}`
}
