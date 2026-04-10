import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'customs_documents',
  title: 'Customs Document Processing',
  version: '0.1.0',
  description: 'Parses B/L, Commercial Invoice and Packing List documents, verifies consistency, and classifies goods with ISZTAR4 HS codes.',
  author: 'Open Mercato Team',
  license: 'MIT',
}
