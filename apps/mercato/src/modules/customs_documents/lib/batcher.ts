// Year-like 4-digit numbers are noise (dates, not transport IDs)
const YEAR_RE = /^(199\d|200\d|201\d|202[0-9]|2030|2031|2032|2033|2034|2035)$/

const IGNORED_TOKENS = new Set([
  'bl', 'bill', 'lading', 'invoice', 'commercial', 'packing', 'list', 'pl', 'ci',
  'doc', 'document', 'pdf', 'file', 'copy', 'original', 'draft', 'final',
  'transport', 'cargo', 'shipment', 'shipping', 'freight', 'new',
  'of', 'the', 'and', 'for',
])

export type FileMeta = {
  attachmentId: string
  fileName?: string | null
}

export type TransportGroup = {
  transportKey: string
  files: FileMeta[]
}

/**
 * Extracts pure numeric sequences from a filename (≥2 digits, non-year).
 * These are the most reliable transport identifiers.
 */
function extractNumbers(fileName: string): string[] {
  const base = fileName.replace(/\.[^.]+$/, '')
  return (base.match(/\d+/g) ?? []).filter(n => !YEAR_RE.test(n))
}

/**
 * Extracts word-level tokens (minus doc-type keywords) as a fallback.
 */
function extractTokens(fileName: string): string[] {
  const base = fileName.replace(/\.[^.]+$/, '')
  return base
    .toLowerCase()
    .split(/[_\-\s.]+/)
    .filter(t => t.length > 1 && !IGNORED_TOKENS.has(t))
}

function buildUnionFind(size: number) {
  const parent = Array.from({ length: size }, (_, i) => i)
  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x])
    return parent[x]
  }
  function union(a: number, b: number) {
    parent[find(a)] = find(b)
  }
  return { find, union, parent }
}

function buildIndex(files: FileMeta[], extractor: (name: string, i: number) => string[]): Map<string, number[]> {
  const index = new Map<string, number[]>()
  files.forEach((file, i) => {
    for (const key of extractor(file.fileName ?? `file_${i}`, i)) {
      if (!index.has(key)) index.set(key, [])
      index.get(key)!.push(i)
    }
  })
  return index
}

function applyUnions(uf: ReturnType<typeof buildUnionFind>, index: Map<string, number[]>, total: number): boolean {
  let anyUnion = false
  for (const indices of index.values()) {
    // Use keys shared by 2+ files but not ALL files
    if (indices.length > 1 && indices.length < total) {
      for (let i = 1; i < indices.length; i++) {
        uf.union(indices[0], indices[i])
      }
      anyUnion = true
    }
  }
  return anyUnion
}

function collectGroups(uf: ReturnType<typeof buildUnionFind>, files: FileMeta[]): Array<{ indices: number[]; files: FileMeta[] }> {
  const groupMap = new Map<number, number[]>()
  for (let i = 0; i < files.length; i++) {
    const root = uf.find(i)
    if (!groupMap.has(root)) groupMap.set(root, [])
    groupMap.get(root)!.push(i)
  }
  return Array.from(groupMap.values()).map(indices => ({ indices, files: indices.map(i => files[i]) }))
}

function pickTransportKey(groupFiles: FileMeta[], groupIdx: number): string {
  // Prefer a number shared by all files in the group
  const numberSets = groupFiles.map(f => new Set(extractNumbers(f.fileName ?? '')))
  const sharedNumbers = numberSets.length > 0
    ? [...numberSets[0]].filter(n => numberSets.every(s => s.has(n)))
    : []

  if (sharedNumbers.length > 0) {
    // Prefer longer numbers (more specific)
    return sharedNumbers.sort((a, b) => b.length - a.length)[0].toUpperCase()
  }

  // Fall back to shared word tokens
  const tokenSets = groupFiles.map(f => new Set(extractTokens(f.fileName ?? '')))
  const sharedTokens = tokenSets.length > 0
    ? [...tokenSets[0]].filter(t => tokenSets.every(s => s.has(t)))
    : []

  if (sharedTokens.length > 0) {
    return sharedTokens.sort((a, b) => b.length - a.length)[0].toUpperCase()
  }

  return `GROUP_${groupIdx + 1}`
}

/**
 * Groups files by transport number extracted from their filenames.
 *
 * Primary strategy: extract numeric sequences — the transport number the user
 * embedded in each filename. Files sharing the same number land in one group.
 *
 * Fallback: word-token matching after stripping common document-type keywords,
 * for filenames that encode the transport key as text rather than a number.
 */
export function groupFilesByTransport(files: FileMeta[]): TransportGroup[] {
  if (files.length === 0) return []

  const uf = buildUnionFind(files.length)

  // Primary: group by shared numeric sequences
  const numIndex = buildIndex(files, (name) => extractNumbers(name))
  const numericGrouped = applyUnions(uf, numIndex, files.length)

  // Fallback: if numbers alone produced no grouping, try word tokens
  if (!numericGrouped) {
    const tokenIndex = buildIndex(files, (name) => extractTokens(name))
    applyUnions(uf, tokenIndex, files.length)
  }

  const groups = collectGroups(uf, files)
  return groups.map(({ files: groupFiles }, idx) => ({
    transportKey: pickTransportKey(groupFiles, idx),
    files: groupFiles,
  }))
}
