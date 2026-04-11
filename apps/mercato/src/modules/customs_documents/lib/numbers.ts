type DeclarationNumericShape = {
  grossWeightBl?: unknown
  grossWeightPl?: unknown
  packageCountBl?: unknown
  packageCountPl?: unknown
  totalValueUsd?: unknown
}

type LineItemNumericShape = {
  quantity?: unknown
  unitPriceUsd?: unknown
  totalValueUsd?: unknown
  grossWeightKg?: unknown
  netWeightKg?: unknown
}

type NormalizedDeclarationNumericShape = {
  grossWeightBl: number | null
  grossWeightPl: number | null
  packageCountBl: number | null
  packageCountPl: number | null
  totalValueUsd: number | null
}

type NormalizedLineItemNumericShape = {
  quantity: number
  unitPriceUsd: number | null
  totalValueUsd: number | null
  grossWeightKg: number | null
  netWeightKg: number | null
}

function normalizeNumericString(value: string): string {
  const commaCount = (value.match(/,/g) ?? []).length
  const dotCount = (value.match(/\./g) ?? []).length
  const separatorCount = commaCount + dotCount
  if (separatorCount === 0) return value

  const hasMixedSeparators = commaCount > 0 && dotCount > 0
  if (hasMixedSeparators) {
    const decimalIndex = Math.max(value.lastIndexOf(','), value.lastIndexOf('.'))
    const integerPart = value.slice(0, decimalIndex).replace(/[.,]/g, '')
    const fractionalPart = value.slice(decimalIndex + 1).replace(/[.,]/g, '')
    return fractionalPart.length > 0 ? `${integerPart || '0'}.${fractionalPart}` : integerPart
  }

  const separator = commaCount > 0 ? ',' : '.'
  const lastIndex = value.lastIndexOf(separator)
  const leadingRaw = value.slice(0, lastIndex)
  const trailingRaw = value.slice(lastIndex + 1)
  const leadingDigits = leadingRaw.replace(/[.,]/g, '')
  const trailingDigits = trailingRaw.replace(/[.,]/g, '')

  const treatAsDecimal = trailingDigits.length > 0
    && (
      trailingDigits.length <= 2
      || (
        separatorCount === 1
        && trailingDigits.length === 3
        && (leadingDigits.length > 3 || leadingDigits === '0')
      )
    )

  if (!treatAsDecimal) return value.replace(/[.,]/g, '')
  return `${leadingDigits || '0'}.${trailingDigits}`
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const isParenthesizedNegative = /^\(.*\)$/.test(trimmed)
  const withoutParens = isParenthesizedNegative ? trimmed.slice(1, -1) : trimmed
  const compact = withoutParens.replace(/\s+/g, '')
  const hasMinus = compact.includes('-')
  const unsignedToken = compact.replace(/[+-]/g, '')
  const stripped = unsignedToken.replace(/[^0-9.,]/g, '')
  if (!stripped) return null

  const normalized = normalizeNumericString(stripped)
  if (!normalized) return null

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null

  return isParenthesizedNegative || hasMinus ? -parsed : parsed
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = parseFiniteNumber(value)
  return parsed ?? fallback
}

export function toFiniteInteger(value: unknown, fallback = 0): number {
  const parsed = toFiniteNumber(value, Number.NaN)
  if (!Number.isFinite(parsed)) return fallback
  return Math.trunc(parsed)
}

export function toNullableFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = toFiniteNumber(value, Number.NaN)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeDeclarationNumerics<T extends DeclarationNumericShape>(
  declaration: T,
): Omit<T, keyof DeclarationNumericShape> & NormalizedDeclarationNumericShape {
  return {
    ...declaration,
    grossWeightBl: toNullableFiniteNumber(declaration.grossWeightBl),
    grossWeightPl: toNullableFiniteNumber(declaration.grossWeightPl),
    packageCountBl: toNullableFiniteNumber(declaration.packageCountBl),
    packageCountPl: toNullableFiniteNumber(declaration.packageCountPl),
    totalValueUsd: toNullableFiniteNumber(declaration.totalValueUsd),
  }
}

export function normalizeLineItemNumerics<T extends LineItemNumericShape>(
  lineItem: T,
): Omit<T, keyof LineItemNumericShape> & NormalizedLineItemNumericShape {
  return {
    ...lineItem,
    quantity: toFiniteNumber(lineItem.quantity, 0),
    unitPriceUsd: toNullableFiniteNumber(lineItem.unitPriceUsd),
    totalValueUsd: toNullableFiniteNumber(lineItem.totalValueUsd),
    grossWeightKg: toNullableFiniteNumber(lineItem.grossWeightKg),
    netWeightKg: toNullableFiniteNumber(lineItem.netWeightKg),
  }
}

export function sumBy<T>(items: T[], pickValue: (item: T) => unknown): number {
  return items.reduce((sum, item) => sum + toFiniteNumber(pickValue(item), 0), 0)
}
