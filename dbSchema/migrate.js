import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  try {
    await client.connect();
    console.log('Connected to database');

    // Add workos_id column if it doesn't exist
    try {
      await client.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS workos_id text;');
      console.log('✅ Added workos_id column');
    } catch (error) {
      console.log('Column might already exist:', error.message);
    }

    // Add unique constraint if it doesn't exist
    try {
      await client.query('ALTER TABLE accounts ADD CONSTRAINT accounts_workos_id_unique UNIQUE(workos_id);');
      console.log('✅ Added unique constraint on workos_id');
    } catch (error) {
      console.log('Constraint might already exist:', error.message);
    }

    console.log('✅ Migration completed successfully');

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

migrate();