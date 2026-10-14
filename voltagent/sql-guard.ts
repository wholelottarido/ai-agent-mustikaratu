/**
 * Validator SQL — lapis pengaman ke-2 (lapis ke-1 = user MySQL read-only).
 *
 * Tugasnya: pastikan SQL yang ditulis LLM aman dijalankan.
 * Aturan: hanya satu statement SELECT/WITH, tanpa komentar,
 * tanpa kata kunci yang mengubah data, dan wajib ada LIMIT.
 */

export type HasilValidasi =
  | { ok: true; sql: string; catatan: string[] }
  | { ok: false; alasan: string };

/** Kata kunci yang tidak boleh muncul di query mana pun. */
const KATA_TERLARANG = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE',
  'GRANT', 'REVOKE', 'REPLACE', 'RENAME', 'LOAD', 'OUTFILE', 'DUMPFILE',
  'INTO', 'CALL', 'HANDLER', 'LOCK', 'UNLOCK', 'EXECUTE', 'PREPARE',
  'DEALLOCATE', 'ATTACH', 'INSTALL', 'UNINSTALL', 'SHUTDOWN', 'KILL',
  'BENCHMARK', 'SLEEP',
];

/**
 * Ganti isi string literal & identifier ber-backtick dengan placeholder.
 *
 * Wajib dilakukan SEBELUM mencari kata terlarang. Tanpa ini, query sah
 * seperti  WHERE komentar LIKE '%update%'  akan ditolak — dan di database
 * marketing itu kasus nyata (kolom customer_feedback.komentar).
 */
function samarkanLiteral(sql: string): string {
  let hasil = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      const penutup = c;
      i++;
      while (i < sql.length) {
        if (sql.charCodeAt(i) === 92) { i += 2; continue; }   // karakter escape
        if (sql[i] === penutup) {
          if (sql[i + 1] === penutup) { i += 2; continue; }  // '' di dalam string
          i++;
          break;
        }
        i++;
      }
      hasil += penutup === '`' ? '`x`' : "'x'";
      continue;
    }
    hasil += c;
    i++;
  }
  return hasil;
}

/** Cari LIMIT di level teratas (bukan yang ada di dalam subquery). */
function punyaLimitTopLevel(sqlSamar: string): boolean {
  let kedalaman = 0;
  const atas: string[] = [];
  for (const c of sqlSamar) {
    if (c === '(') kedalaman++;
    else if (c === ')') kedalaman--;
    else if (kedalaman === 0) atas.push(c);
  }
  return /\bLIMIT\b/i.test(atas.join(''));
}

export function validasiSql(sqlMentah: string, maxRows = 200): HasilValidasi {
  const catatan: string[] = [];
  let sql = sqlMentah.trim();

  if (!sql) return { ok: false, alasan: 'Query kosong.' };

  // Buang titik koma di akhir supaya tidak dianggap multi-statement.
  sql = sql.replace(/;\s*$/, '').trim();

  const samar = samarkanLiteral(sql);

  // 1. Komentar tidak diizinkan — sering dipakai menyelundupkan perintah.
  if (/(--|#|\/\*)/.test(samar)) {
    return { ok: false, alasan: 'Query tidak boleh mengandung komentar (--, #, /*).' };
  }

  // 2. Harus satu statement saja.
  if (samar.includes(';')) {
    return { ok: false, alasan: 'Hanya boleh satu statement. Titik koma di tengah query tidak diizinkan.' };
  }

  // 3. Harus diawali SELECT atau WITH (CTE).
  if (!/^\s*(SELECT|WITH)\b/i.test(samar)) {
    return { ok: false, alasan: 'Query harus diawali SELECT atau WITH. Hanya operasi baca yang diizinkan.' };
  }

  // 4. Tidak boleh ada kata kunci yang mengubah data / berbahaya.
  for (const kata of KATA_TERLARANG) {
    if (new RegExp(`\\b${kata}\\b`, 'i').test(samar)) {
      return { ok: false, alasan: `Kata kunci "${kata}" tidak diizinkan. Database ini read-only.` };
    }
  }

  // 5. Wajib LIMIT. Kalau belum ada, tambahkan otomatis.
  if (!punyaLimitTopLevel(samar)) {
    sql += ` LIMIT ${maxRows}`;
    catatan.push(`LIMIT ${maxRows} ditambahkan otomatis karena query belum punya LIMIT.`);
  } else {
    // Kalau ada tapi kebesaran, turunkan ke batas aman.
    const cocok = sql.match(/\bLIMIT\s+(\d+)\s*$/i);
    if (cocok && Number(cocok[1]) > maxRows) {
      sql = sql.replace(/\bLIMIT\s+\d+\s*$/i, `LIMIT ${maxRows}`);
      catatan.push(`LIMIT diturunkan dari ${cocok[1]} ke ${maxRows} (batas maksimum).`);
    }
  }

  return { ok: true, sql, catatan };
}
