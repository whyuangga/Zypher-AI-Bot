/**
 * Pemeriksaan runtime sebelum apa pun diimpor.
 *
 * `node:sqlite` hanya ada di Node 22+, dan pesan error bawaan Node untuk itu
 * ("Cannot find module 'node:sqlite'") sangat membingungkan di panel hosting.
 * Modul ini diimpor PALING AWAL di `index.ts` supaya pesannya jelas.
 */

const REQUIRED_MAJOR = 22;

const [majorRaw, minorRaw] = process.versions.node.split('.');
const major = Number(majorRaw ?? 0);
const minor = Number(minorRaw ?? 0);

function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

if (!Number.isFinite(major) || major < REQUIRED_MAJOR) {
  fail(
    [
      `Node.js kamu versi ${process.versions.node}, bot ini butuh Node.js ${REQUIRED_MAJOR}+.`,
      '',
      'Alasannya: bot memakai modul bawaan `node:sqlite` yang baru ada di Node 22.',
      '',
      'Cara memperbaiki:',
      '  • Panel hosting  : ganti Docker image / runtime ke Node.js 22 atau lebih baru',
      '                     (di panel biasanya ada di menu Startup → Docker Image).',
      '  • Komputer sendiri: pasang Node 22 LTS dari https://nodejs.org',
      '  • Cek versi      : node -v   (harus v22.x atau v24.x)',
    ].join('\n'),
  );
}

// Node 22.0–22.4 punya node:sqlite, tapi DatabaseSync baru lengkap sejak 22.5.
if (major === 22 && minor < 5) {
  fail(
    [
      `Node.js ${process.versions.node} terlalu lama — butuh 22.5 atau lebih baru.`,
      'Perbarui Node.js (nodejs.org) atau ganti image di panel hosting.',
    ].join('\n'),
  );
}
