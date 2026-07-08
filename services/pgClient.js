const { Pool, types } = require('pg');

// Return DATE columns as plain YYYY-MM-DD strings (OID 1082), not Date objects.
// node-postgres default converts them to JS Date → ISO timestamp with timezone offset,
// which shifts the displayed date when the frontend renders it locally.
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  host:     process.env.PG_HOST,
  port:     Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE || 'postgres',
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false, minVersion: 'TLSv1.2' },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('PG pool error:', err.message);
});

// Run a query with optional RLS context (project_id / company_id)
async function query(sql, params = [], context = {}) {
  const client = await pool.connect();
  try {
    const hasCtx = context.project_id || context.company_id;
    if (hasCtx) {
      await client.query('BEGIN');
      if (context.project_id) {
        await client.query('SELECT set_config($1, $2, true)', ['app.project_id', String(context.project_id)]);
      }
      if (context.company_id) {
        await client.query('SELECT set_config($1, $2, true)', ['app.company_id', String(context.company_id)]);
      }
    }
    const result = await client.query(sql, params);
    if (hasCtx) await client.query('COMMIT');
    return result;
  } catch (err) {
    if (context.project_id || context.company_id) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query };
