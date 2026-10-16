import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_builds_status" AS ENUM('queued', 'building', 'succeeded', 'failed');
  CREATE TABLE "builds" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"client_id" integer NOT NULL,
  	"label" varchar,
  	"status" "enum_builds_status" NOT NULL,
  	"config_version_id" integer NOT NULL,
  	"config_number" numeric NOT NULL,
  	"template_version" varchar NOT NULL,
  	"licence_id" varchar NOT NULL,
  	"requested_by_id" integer,
  	"rebuild_of_id" integer,
  	"run_url" varchar,
  	"started_at" timestamp(3) with time zone,
  	"finished_at" timestamp(3) with time zone,
  	"error" varchar,
  	"zip_key" varchar,
  	"zip_name" varchar,
  	"size" numeric,
  	"sha256" varchar,
  	"commit" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "builds_id" integer;
  ALTER TABLE "builds" ADD CONSTRAINT "builds_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "builds" ADD CONSTRAINT "builds_config_version_id_client_configs_id_fk" FOREIGN KEY ("config_version_id") REFERENCES "public"."client_configs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "builds" ADD CONSTRAINT "builds_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "builds" ADD CONSTRAINT "builds_rebuild_of_id_builds_id_fk" FOREIGN KEY ("rebuild_of_id") REFERENCES "public"."builds"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "builds_client_idx" ON "builds" USING btree ("client_id");
  CREATE INDEX "builds_status_idx" ON "builds" USING btree ("status");
  CREATE INDEX "builds_config_version_idx" ON "builds" USING btree ("config_version_id");
  CREATE INDEX "builds_requested_by_idx" ON "builds" USING btree ("requested_by_id");
  CREATE INDEX "builds_rebuild_of_idx" ON "builds" USING btree ("rebuild_of_id");
  CREATE INDEX "builds_updated_at_idx" ON "builds" USING btree ("updated_at");
  CREATE INDEX "builds_created_at_idx" ON "builds" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_builds_fk" FOREIGN KEY ("builds_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_builds_id_idx" ON "payload_locked_documents_rels" USING btree ("builds_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "builds" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "builds" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_builds_fk";
  
  DROP INDEX "payload_locked_documents_rels_builds_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "builds_id";
  DROP TYPE "public"."enum_builds_status";`)
}
