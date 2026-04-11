import {
  normalizeDeclarationNumerics,
  normalizeLineItemNumerics,
  sumBy,
  toFiniteInteger,
  toFiniteNumber,
  toNullableFiniteNumber,
} from '../numbers'

describe('customs_documents numbers', () => {
  it('coerces number-like strings into finite numbers', () => {
    expect(toFiniteNumber('42.5')).toBe(42.5)
    expect(toFiniteInteger('42.9')).toBe(42)
    expect(toNullableFiniteNumber('19.2')).toBe(19.2)
    expect(toFiniteNumber('1,234.56')).toBe(1234.56)
    expect(toFiniteNumber('1.234,56')).toBe(1234.56)
    expect(toFiniteNumber('USD 2 500,00')).toBe(2500)
    expect(toFiniteNumber('(125.75)')).toBe(-125.75)
  })

  it('falls back for invalid numeric input', () => {
    expect(toFiniteNumber('not-a-number', 7)).toBe(7)
    expect(toFiniteInteger(undefined, 3)).toBe(3)
    expect(toNullableFiniteNumber('broken')).toBeNull()
  })

  it('normalizes declaration and line-item numeric fields', () => {
    const declaration = normalizeDeclarationNumerics({
      grossWeightBl: '1500.5',
      grossWeightPl: null,
      packageCountBl: '12',
      packageCountPl: '10',
      totalValueUsd: '20000.99',
    })
    const lineItem = normalizeLineItemNumerics({
      quantity: '3',
      unitPriceUsd: '5000',
      totalValueUsd: '15000',
      grossWeightKg: '1200.25',
      netWeightKg: null,
    })

    expect(declaration.grossWeightBl).toBe(1500.5)
    expect(declaration.packageCountBl).toBe(12)
    expect(declaration.totalValueUsd).toBe(20000.99)
    expect(lineItem.quantity).toBe(3)
    expect(lineItem.unitPriceUsd).toBe(5000)
    expect(lineItem.grossWeightKg).toBe(1200.25)
  })

  it('sums string-backed numeric values as numbers, not concatenated strings', () => {
    const total = sumBy(
      [{ amount: '10' }, { amount: 5 }, { amount: '7.5' }],
      (entry) => entry.amount,
    )
    expect(total).toBe(22.5)
  })
})
