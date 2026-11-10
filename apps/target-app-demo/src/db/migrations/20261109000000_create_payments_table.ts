export interface KnexTableBuilder {
  uuid(col: string): { primary(): void };
  string(col: string, length?: number): { notNullable(): void; defaultTo?(val: unknown): void };
  decimal(col: string, precision?: number, scale?: number): { notNullable(): void };
  text(col: string): { nullable(): void };
  timestamps(useTimestamps: boolean, defaultToNow: boolean): void;
}

export interface KnexSchema {
  createTable(tableName: string, callback: (table: KnexTableBuilder) => void): Promise<void>;
  dropTableIfExists(tableName: string): Promise<void>;
}

export interface KnexInstance {
  schema: KnexSchema;
}

export async function up(knex: KnexInstance): Promise<void> {
  await knex.schema.createTable('payments', (table) => {
    table.uuid('id').primary();
    table.string('tx_id', 32).notNullable();
    table.decimal('amount', 14, 2).notNullable();
    table.string('currency', 3).notNullable();
    table.string('status', 20).notNullable();
    table.string('payer_cpf', 14).notNullable();
    table.string('merchant_cnpj', 18).notNullable();
    table.string('pix_key', 255).notNullable();
    table.text('description').nullable();
    table.timestamps(true, true);
  });
}

export async function down(knex: KnexInstance): Promise<void> {
  await knex.schema.dropTableIfExists('payments');
}
