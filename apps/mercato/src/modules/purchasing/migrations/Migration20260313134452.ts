import { Migration } from '@mikro-orm/migrations';

export class Migration20260313134452 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "purchasing_request_items" add column "reference_number" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "purchasing_request_items" drop column "reference_number";`);
  }

}
