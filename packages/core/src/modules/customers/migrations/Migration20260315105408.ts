import { Migration } from '@mikro-orm/migrations';

export class Migration20260315105408 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_companies" add column "tax_id" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_companies" drop column "tax_id";`);
  }

}
