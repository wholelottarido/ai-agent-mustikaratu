/**
 * Generator kamus data OTOMATIS.
 *
 * Baca struktur database dari information_schema, tulis jadi
 * docs/<departemen>/schema-auto.md. File ini di-generate ulang tiap kali
 * skema berubah -- JANGAN diedit manual.
 *
 * Penjelasan bisnis yang ditulis tangan ada di docs/<departemen>/kamus-data.md.
 *
 * Jalankan: npm run gen:schema -- marketing
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { departemenDariArgv, sambungkan, namaDb } from './lib/dep.mts';

type Row = Record<string, any>;

const dep = departemenDariArgv();
const conn = await sambungkan(dep);
const DB = namaDb(dep);

const q = async (sql: string, params: any[] = []) =>
  (await conn.query(sql, params))[0] as Row[];

// --- Ambil daftar tabel + komentarnya ---
const tables = await q(
  `SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME`,
  [DB],
);

// View ringkasan (Tahap 4). Dipisah dari tabel karena tidak punya
// foreign key dan jumlah barisnya hasil agregasi, bukan data mentah.
const views = await q(
  `SELECT TABLE_NAME AS name
     FROM information_schema.VIEWS
    WHERE TABLE_SCHEMA = ?
    ORDER BY TABLE_NAME`,
  [DB],
);

// --- Ambil semua kolom sekaligus ---
const columns = await q(
  `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS name, COLUMN_TYPE AS type,
          IS_NULLABLE AS nullable, COLUMN_KEY AS keyType,
          COLUMN_DEFAULT AS deflt, COLUMN_COMMENT AS comment
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ?
    ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  [DB],
);

// --- Ambil semua foreign key (relasi antar tabel) ---
const fks = await q(
  `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col,
          REFERENCED_TABLE_NAME AS refTbl, REFERENCED_COLUMN_NAME AS refCol
     FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY TABLE_NAME, COLUMN_NAME`,
  [DB],
);

// --- Hitung jumlah baris asli (TABLE_ROWS di InnoDB cuma perkiraan) ---
const counts = new Map<string, number>();
for (const t of [...tables, ...views]) {
  const r = await q(`SELECT COUNT(*) AS n FROM \`${t.name}\``);
  counts.set(t.name, Number(r[0].n));
}

// --- Susun markdown ---
const esc = (s: string) => String(s ?? '').replace(/\|/g, '\|');
const out: string[] = [];

out.push('# Skema Database `' + DB + '` (auto-generated)');
out.push('');
out.push('> Dibuat otomatis oleh `scripts/generate-schema-doc.mts` pada ' +
  new Date().toISOString().slice(0, 10) + '. **Jangan edit manual** — jalankan `npm run gen:schema`.');
out.push('> Penjelasan istilah bisnis ada di [kamus-data.md](kamus-data.md).');
out.push('');

out.push('## Daftar tabel');
out.push('');
out.push('| Tabel | Baris | Keterangan |');
out.push('|---|---:|---|');
for (const t of tables) {
  out.push(`| \`${t.name}\` | ${counts.get(t.name)!.toLocaleString('id-ID')} | ${esc(t.comment) || '—'} |`);
}
out.push('');

if (views.length > 0) {
  out.push('## View ringkasan');
  out.push('');
  out.push('Dibuat oleh `db/03_create_views.sql` (dijalankan sebagai root). Semua pakai `SQL SECURITY INVOKER`.');
  out.push('');
  out.push('| View | Baris |');
  out.push('|---|---:|');
  for (const v of views) {
    out.push(`| \`${v.name}\` | ${counts.get(v.name)!.toLocaleString('id-ID')} |`);
  }
  out.push('');
}

out.push('## Relasi antar tabel');
out.push('');
out.push('| Dari | Kolom | Ke |');
out.push('|---|---|---|');
for (const f of fks) {
  out.push(`| \`${f.tbl}\` | \`${f.col}\` | \`${f.refTbl}.${f.refCol}\` |`);
}
out.push('');

out.push('## Detail kolom');
for (const t of [...tables, ...views]) {
  const cols = columns.filter((c) => c.tbl === t.name);
  const tfks = fks.filter((f) => f.tbl === t.name);

  out.push('');
  out.push(`### \`${t.name}\``);
  out.push('');
  if (t.comment) out.push(`${t.comment}. Jumlah baris: ${counts.get(t.name)!.toLocaleString('id-ID')}.`);
  else out.push(`Jumlah baris: ${counts.get(t.name)!.toLocaleString('id-ID')}.`);
  out.push('');
  out.push('| Kolom | Tipe | Null | Key | Keterangan |');
  out.push('|---|---|---|---|---|');
  for (const c of cols) {
    const fk = tfks.find((f) => f.col === c.name);
    const key = c.keyType === 'PRI' ? 'PK' : fk ? `FK → \`${fk.refTbl}\`` : c.keyType === 'UNI' ? 'unik' : '';
    out.push(
      `| \`${c.name}\` | ${esc(c.type)} | ${c.nullable === 'YES' ? 'ya' : 'tidak'} | ${key} | ${esc(c.comment) || '—'} |`,
    );
  }
}
out.push('');

mkdirSync(`docs/${dep.id}`, { recursive: true });
writeFileSync(`docs/${dep.id}/schema-auto.md`, out.join('\n'), 'utf8');
console.log(
  `OK -> docs/${dep.id}/schema-auto.md (${tables.length} tabel, ${views.length} view, ${columns.length} kolom, ${fks.length} relasi)`,
);

await conn.end();
