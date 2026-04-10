import { Migration } from '@mikro-orm/migrations'

export class Migration20260410000001_customs_documents extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "customs_declarations" (
        "id" uuid not null default gen_random_uuid(),
        "tenant_id" uuid not null,
        "organization_id" uuid not null,
        "status" text not null default 'draft',
        "bl_number" text null,
        "invoice_number" text null,
        "shipper_name" text null,
        "consignee_name" text null,
        "port_of_loading" text null,
        "port_of_discharge" text null,
        "gross_weight_bl" numeric null,
        "gross_weight_pl" numeric null,
        "package_count_bl" int null,
        "package_count_pl" int null,
        "total_value_usd" numeric null,
        "currency" text not null default 'USD',
        "notes" text null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "customs_declarations_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index "customs_declarations_tenant_org_idx" on "customs_declarations" ("tenant_id", "organization_id");`)

    this.addSql(`
      create table "customs_uploaded_documents" (
        "id" uuid not null default gen_random_uuid(),
        "declaration_id" uuid not null,
        "document_type" text not null,
        "attachment_id" uuid null,
        "file_name" text null,
        "parsed_data" jsonb null,
        "parsed_at" timestamptz null,
        "created_at" timestamptz not null,
        constraint "customs_uploaded_documents_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index "customs_docs_declaration_idx" on "customs_uploaded_documents" ("declaration_id");`)

    this.addSql(`
      create table "customs_line_items" (
        "id" uuid not null default gen_random_uuid(),
        "declaration_id" uuid not null,
        "description" text not null,
        "quantity" int not null default 1,
        "gross_weight_kg" numeric null,
        "net_weight_kg" numeric null,
        "unit_price_usd" numeric null,
        "total_value_usd" numeric null,
        "container_number" text null,
        "vin" text null,
        "engine_number" text null,
        "hs_code_selected" text null,
        "hs_proposals" jsonb null,
        "created_at" timestamptz not null,
        constraint "customs_line_items_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index "customs_line_items_declaration_idx" on "customs_line_items" ("declaration_id");`)

    this.addSql(`
      create table "customs_discrepancies" (
        "id" uuid not null default gen_random_uuid(),
        "declaration_id" uuid not null,
        "field_name" text not null,
        "source_a" text not null,
        "value_a" text not null,
        "source_b" text not null,
        "value_b" text not null,
        "severity" text not null default 'error',
        "is_resolved" boolean not null default false,
        "resolution_note" text null,
        "created_at" timestamptz not null,
        constraint "customs_discrepancies_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index "customs_discrepancies_declaration_idx" on "customs_discrepancies" ("declaration_id");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "customs_discrepancies" cascade;`)
    this.addSql(`drop table if exists "customs_line_items" cascade;`)
    this.addSql(`drop table if exists "customs_uploaded_documents" cascade;`)
    this.addSql(`drop table if exists "customs_declarations" cascade;`)
  }
}
