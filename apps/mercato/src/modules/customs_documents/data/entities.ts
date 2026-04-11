import { Entity, PrimaryKey, Property, Index, OptionalProps } from '@mikro-orm/core'

@Entity({ tableName: 'customs_declarations' })
@Index({ name: 'customs_declarations_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class CustomsDeclaration {
  [OptionalProps]?: 'status' | 'currency' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text', default: 'draft' })
  status: 'draft' | 'uploaded' | 'parsed' | 'verified' | 'classified' = 'draft'

  @Property({ name: 'bl_number', type: 'text', nullable: true })
  blNumber?: string | null

  @Property({ name: 'invoice_number', type: 'text', nullable: true })
  invoiceNumber?: string | null

  @Property({ name: 'shipper_name', type: 'text', nullable: true })
  shipperName?: string | null

  @Property({ name: 'consignee_name', type: 'text', nullable: true })
  consigneeName?: string | null

  @Property({ name: 'port_of_loading', type: 'text', nullable: true })
  portOfLoading?: string | null

  @Property({ name: 'port_of_discharge', type: 'text', nullable: true })
  portOfDischarge?: string | null

  @Property({ name: 'gross_weight_bl', type: 'numeric', nullable: true })
  grossWeightBl?: number | null

  @Property({ name: 'gross_weight_pl', type: 'numeric', nullable: true })
  grossWeightPl?: number | null

  @Property({ name: 'package_count_bl', type: 'int', nullable: true })
  packageCountBl?: number | null

  @Property({ name: 'package_count_pl', type: 'int', nullable: true })
  packageCountPl?: number | null

  @Property({ name: 'total_value_usd', type: 'numeric', nullable: true })
  totalValueUsd?: number | null

  @Property({ type: 'text', default: 'USD' })
  currency: string = 'USD'

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'customs_uploaded_documents' })
@Index({ name: 'customs_docs_declaration_idx', properties: ['declarationId'] })
export class CustomsUploadedDocument {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'declaration_id', type: 'uuid' })
  declarationId!: string

  @Property({ name: 'document_type', type: 'text' })
  documentType!: 'bl' | 'invoice' | 'packing_list'

  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  @Property({ name: 'file_name', type: 'text', nullable: true })
  fileName?: string | null

  @Property({ name: 'parsed_data', type: 'jsonb', nullable: true })
  parsedData?: Record<string, unknown> | null

  @Property({ name: 'parsed_at', type: Date, nullable: true })
  parsedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'customs_line_items' })
@Index({ name: 'customs_line_items_declaration_idx', properties: ['declarationId'] })
export class CustomsLineItem {
  [OptionalProps]?: 'quantity' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'declaration_id', type: 'uuid' })
  declarationId!: string

  @Property({ type: 'text' })
  description!: string

  @Property({ type: 'int', default: 1 })
  quantity: number = 1

  @Property({ name: 'gross_weight_kg', type: 'numeric', nullable: true })
  grossWeightKg?: number | null

  @Property({ name: 'net_weight_kg', type: 'numeric', nullable: true })
  netWeightKg?: number | null

  @Property({ name: 'unit_price_usd', type: 'numeric', nullable: true })
  unitPriceUsd?: number | null

  @Property({ name: 'total_value_usd', type: 'numeric', nullable: true })
  totalValueUsd?: number | null

  @Property({ name: 'container_number', type: 'text', nullable: true })
  containerNumber?: string | null

  @Property({ type: 'text', nullable: true })
  vin?: string | null

  @Property({ name: 'engine_number', type: 'text', nullable: true })
  engineNumber?: string | null

  @Property({ name: 'hs_code_selected', type: 'text', nullable: true })
  hsCodeSelected?: string | null

  @Property({ name: 'hs_proposals', type: 'jsonb', nullable: true })
  hsProposals?: Array<{ code: string; description: string; dutyAmount: string }> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'customs_discrepancies' })
@Index({ name: 'customs_discrepancies_declaration_idx', properties: ['declarationId'] })
export class CustomsDiscrepancy {
  [OptionalProps]?: 'severity' | 'isResolved' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'declaration_id', type: 'uuid' })
  declarationId!: string

  @Property({ name: 'field_name', type: 'text' })
  fieldName!: string

  @Property({ name: 'source_a', type: 'text' })
  sourceA!: string

  @Property({ name: 'value_a', type: 'text' })
  valueA!: string

  @Property({ name: 'source_b', type: 'text' })
  sourceB!: string

  @Property({ name: 'value_b', type: 'text' })
  valueB!: string

  @Property({ type: 'text', default: 'error' })
  severity: 'error' | 'warning' = 'error'

  @Property({ name: 'is_resolved', type: 'boolean', default: false })
  isResolved: boolean = false

  @Property({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
