import { Migration } from '@mikro-orm/migrations'

export class Migration20260412000001_customs_declarations_is_new extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "customs_declarations"
      add column "is_new" boolean not null default false;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customs_declarations" drop column "is_new";`)
  }
}
