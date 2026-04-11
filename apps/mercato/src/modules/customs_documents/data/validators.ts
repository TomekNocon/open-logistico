import { z } from 'zod'

export const createDeclarationSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
})

export const updateDeclarationSchema = z.object({
  status: z.enum(['draft', 'uploaded', 'parsed', 'verified', 'classified']).optional(),
  notes: z.string().max(2000).optional().nullable(),
})

export const attachDocumentSchema = z.object({
  documentType: z.enum(['bl', 'invoice', 'packing_list']),
  attachmentId: z.string().uuid(),
  fileName: z.string().max(500).optional(),
})

export const hsSearchSchema = z.object({
  description: z.string().min(1).max(500),
  language: z.enum(['PL', 'EN']).default('EN'),
})

export const updateLineItemSchema = z.object({
  hsCodeSelected: z.string().max(20).optional().nullable(),
  hsProposals: z.array(z.object({
    code: z.string(),
    description: z.string(),
    dutyAmount: z.string(),
  })).optional().nullable(),
})

export const detectDocumentsSchema = z.object({
  files: z.array(z.object({
    attachmentId: z.string().uuid(),
    fileName: z.string().max(500).optional(),
  })).min(1).max(3),
})

export const listDeclarationsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  status: z.string().optional(),
  search: z.string().optional(),
})
