import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sales" ADD COLUMN "discount_approved_by_id" integer;
  ALTER TABLE "sales" ADD COLUMN "client_ref" varchar NOT NULL;
  ALTER TABLE "system_settings" ADD COLUMN "approvals_discount_limit_percent" numeric DEFAULT 10 NOT NULL;
  ALTER TABLE "sales" ADD CONSTRAINT "sales_discount_approved_by_id_users_id_fk" FOREIGN KEY ("discount_approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "sales_discount_approved_by_idx" ON "sales" USING btree ("discount_approved_by_id");
  CREATE UNIQUE INDEX "sales_client_ref_idx" ON "sales" USING btree ("client_ref");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sales" DROP CONSTRAINT "sales_discount_approved_by_id_users_id_fk";
  
  DROP INDEX "sales_discount_approved_by_idx";
  DROP INDEX "sales_client_ref_idx";
  ALTER TABLE "sales" DROP COLUMN "discount_approved_by_id";
  ALTER TABLE "sales" DROP COLUMN "client_ref";
  ALTER TABLE "system_settings" DROP COLUMN "approvals_discount_limit_percent";`)
}
