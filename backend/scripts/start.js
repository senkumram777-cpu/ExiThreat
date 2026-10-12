/**
 * Start-up for the hosted server: bring the database up to date, then start the API.
 *
 * The tables are changed only by the migrations in prisma/migrations, in order
 * (`prisma migrate deploy`). A database from before migrations existed already has the
 * tables of the first one, 0_init, but no record of it; that one is then marked as applied
 * and the rest are run. If the migrations cannot be applied, the server does not start.
 *
 * Plain JavaScript rather than a shell script, so that Windows line endings cannot break it.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const prisma = path.join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');

function migrate(...args) {
  const result = spawnSync(process.execPath, [prisma, 'migrate', ...args], { encoding: 'utf8' });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

let deployed = migrate('deploy');
// P3005: the database has tables but no migration history.
if (!deployed.ok && deployed.output.includes('P3005')) {
  console.log('Database predates migrations: recording 0_init as already applied.');
  if (migrate('resolve', '--applied', '0_init').ok) deployed = migrate('deploy');
}
if (!deployed.ok) {
  console.error('Migrations could not be applied. Not starting.');
  process.exit(1);
}

require('../dist/index.js');
