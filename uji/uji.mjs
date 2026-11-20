// Uji otomatis: menjalankan 3 server di port khusus, lalu menembak lewat client sungguhan.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { io as klien } from 'socket.io-client';

const tmp = mkdtempSync(join(tmpdir(), 'uji-chat-'));
Object.assign(process.env, {
  WS_PORT: '4101', CHAT_PORT: '4102', NOTIF_PORT: '4103',
  CHAT_RIWAYAT: join(tmp, 'riwayat.json'), API_KEY: 'kunci-uji',
});
await Promise.all([
  import('../01-ws-dasar/server.js'),
  import('../02-chat/server.js'),
  import('../03-notifikasi/server.js'),
]);

let ok = 0, gagal = 0;
function cek(nama, kondisi, detail = '') {
  if (kondisi) { ok++; console.log(`  OK     ${nama}`); }
  else { gagal++; console.log(`  GAGAL  ${nama} ${detail}`); }
}
const jeda = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tunggu satu event; null jika tidak datang dalam ms. */
function tunggu(emitter, event, ms = 800) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { emitter.off(event, h); resolve(null); }, ms);
    const h = (x) => { clearTimeout(t); resolve(x); };
    emitter.once(event, h);
  });
}
/** Tunggu satu pesan ws bertipe tertentu. */
function tungguWs(ws, type, ms = 800) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { ws.off('message', h); resolve(null); }, ms);
    const h = (d) => {
      const p = JSON.parse(d.toString());
      if (p.type === type) { clearTimeout(t); ws.off('message', h); resolve(p); }
    };
    ws.on('message', h);
  });
}
const emitAck = (s, ev, ...args) => new Promise((r) => s.emit(ev, ...args, r));
const sioBuka = (port, auth) => new Promise((resolve) => {
  const s = klien(`http://localhost:${port}`, { auth, reconnection: false, forceNew: true });
  s.on('connect', () => resolve(s));
  s.on('connect_error', (e) => resolve({ error: e.message, close: () => s.close() }));
});
const http = (port, method, path, body, headers = {}) =>
  fetch(`http://localhost:${port}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

// ======================= 01 WebSocket dasar =======================
console.log('\n01 WebSocket dasar');
{
  const a = new WebSocket('ws://localhost:4101');
  const sambutan = await tungguWs(a, 'selamat-datang');
  cek('client menerima selamat-datang', sambutan?.type === 'selamat-datang');
  const b = new WebSocket('ws://localhost:4101');
  await tungguWs(b, 'selamat-datang');
  const online = await tungguWs(a, 'online');
  cek('jumlah online bertambah jadi 2', online?.online === 2, JSON.stringify(online));

  const dariB = tungguWs(b, 'chat');
  const dariA = tungguWs(a, 'chat');
  a.send(JSON.stringify({ type: 'chat', text: '  halo  ' }));
  const [pb, pa] = await Promise.all([dariB, dariA]);
  cek('pesan di-broadcast ke client lain', pb?.text === 'halo');
  cek('pesan juga kembali ke pengirim', pa?.text === 'halo');

  const err = tungguWs(a, 'error');
  a.send('bukan json');
  cek('non-JSON ditolak dengan error', (await err)?.message.includes('JSON'));
  const err2 = tungguWs(a, 'error');
  a.send(JSON.stringify({ type: 'chat', text: '   ' }));
  cek('teks kosong ditolak', (await err2)?.type === 'error');

  const turun = tungguWs(a, 'online');
  b.close();
  cek('online berkurang saat client putus', (await turun)?.online === 1);
  a.close();
}

// ======================= 02 Chat Socket.IO =======================
console.log('\n02 Chat Socket.IO');
{
  const pendek = await sioBuka(4102, { nama: 'A' });
  cek('nama 1 karakter ditolak middleware', pendek.error === 'Nama harus 2-20 karakter.', pendek.error);
  pendek.close();
  const tanpa = await sioBuka(4102, {});
  cek('tanpa nama ditolak middleware', Boolean(tanpa.error));
  tanpa.close();

  const andi = await sioBuka(4102, { nama: 'Andi' });
  const siti = await sioBuka(4102, { nama: 'Siti' });
  const budi = await sioBuka(4102, { nama: 'Budi' });
  cek('3 client terhubung', andi.connected && siti.connected && budi.connected);

  cek('chat sebelum join ditolak', (await emitAck(andi, 'chat', 'halo')).ok === false);
  cek('join room tidak ada ditolak', (await emitAck(andi, 'join', 'xxx')).ok === false);
  const j1 = await emitAck(andi, 'join', 'umum');
  cek('join room umum berhasil + riwayat kosong', j1.ok && j1.riwayat.length === 0);
  await emitAck(siti, 'join', 'umum');
  await emitAck(budi, 'join', 'ti-5a');

  const keSiti = tunggu(siti, 'chat');
  const keBudi = tunggu(budi, 'chat', 400);
  const ackA = await emitAck(andi, 'chat', 'halo umum');
  cek('ack pengirim ok + id', ackA.ok && typeof ackA.id === 'string');
  cek('anggota room yang sama menerima chat', (await keSiti)?.text === 'halo umum');
  cek('room berbeda TIDAK menerima chat', (await keBudi) === null);

  const ketik = tunggu(siti, 'mengetik');
  const ketikSendiri = tunggu(andi, 'mengetik', 400);
  andi.emit('mengetik', true);
  cek('indikator mengetik sampai ke anggota lain', (await ketik)?.nama === 'Andi');
  cek('indikator mengetik tidak dikirim ke pengirim', (await ketikSendiri) === null);

  const baru = await sioBuka(4102, { nama: 'Dewi' });
  const jb = await emitAck(baru, 'join', 'umum');
  cek('pendatang baru menerima riwayat room', jb.riwayat.length === 1 && jb.riwayat[0].text === 'halo umum');
  baru.close();

  // Latihan 3: riwayat persisten
  const file = JSON.parse(readFileSync(process.env.CHAT_RIWAYAT, 'utf8'));
  cek('Latihan 3: riwayat tertulis ke file JSON', file.umum?.length === 1 && file.umum[0].nama === 'Andi');

  // Latihan 2: pesan pribadi
  const keSitiP = tunggu(siti, 'pribadi');
  const keAndiP = tunggu(andi, 'pribadi');
  const keBudiP = tunggu(budi, 'pribadi', 400);
  const ackP = await emitAck(andi, 'pribadi', { tujuan: 'Siti', text: 'rahasia' });
  cek('Latihan 2: ack pesan pribadi ok', ackP.ok === true);
  cek('Latihan 2: tujuan menerima pesan pribadi', (await keSitiP)?.text === 'rahasia');
  cek('Latihan 2: pengirim mendapat salinan', (await keAndiP)?.tujuan === 'Siti');
  cek('Latihan 2: pihak ketiga TIDAK menerima', (await keBudiP) === null);
  const offline = await emitAck(andi, 'pribadi', { tujuan: 'Tidakada', text: 'x' });
  cek('Latihan 2: tujuan offline ditolak', offline.ok === false && offline.message === 'Pengguna tidak online.');

  // Latihan 1: batas 5 pesan / 10 detik (sudah terpakai: 1 chat + 1 pribadi dari Andi)
  const hasil = [];
  for (let i = 0; i < 5; i++) hasil.push((await emitAck(andi, 'chat', `spam ${i}`)).ok);
  cek('Latihan 1: pesan ke-6 dst ditolak', hasil.slice(0, 3).every(Boolean) && hasil.slice(3).every((x) => x === false), JSON.stringify(hasil));
  const ditolak = await emitAck(andi, 'chat', 'lagi');
  cek('Latihan 1: pesan error "Terlalu cepat"', ditolak.message === 'Terlalu cepat, tunggu sebentar.');
  cek('Latihan 1: pengguna lain tidak ikut terkena batas', (await emitAck(siti, 'chat', 'aman')).ok === true);

  for (const s of [andi, siti, budi]) s.close();
}

// ======================= 03 Notifikasi =======================
console.log('\n03 Notifikasi status surat');
{
  const admin = await sioBuka(4103, {});
  const siti = await sioBuka(4103, {});
  const dewi = await sioBuka(4103, {});
  cek('gabung admin ok', (await emitAck(admin, 'gabung', { peran: 'admin' })).ok);
  cek('gabung mahasiswa ok', (await emitAck(siti, 'gabung', { peran: 'mahasiswa', nim: '2201002' })).ok);
  await emitAck(dewi, 'gabung', { peran: 'mahasiswa', nim: '2201004' });
  cek('gabung peran/NIM tidak valid ditolak', (await emitAck(dewi, 'gabung', { peran: 'mahasiswa', nim: 'abc' })).ok === false);

  const list = await http(4103, 'GET', '/api/v1/surat?nim=2201002');
  cek('GET surat?nim= memfilter', list.status === 200 && list.json.data.length === 1 && list.json.data[0].nim === '2201002');

  const eAdmin = tunggu(admin, 'surat:status');
  const eSiti = tunggu(siti, 'surat:status');
  const eDewi = tunggu(dewi, 'surat:status', 400);
  const r = await http(4103, 'PATCH', '/api/v1/surat/2/status', { status: 'selesai', catatan: 'Silakan ambil' });
  cek('PATCH status sah -> 200', r.status === 200 && r.json.data.status === 'selesai');
  cek('admin menerima notifikasi', (await eAdmin)?.sumber === 'dashboard');
  const ns = await eSiti;
  cek('mahasiswa pemilik menerima notifikasi', ns?.status === 'selesai' && ns?.catatan === 'Silakan ambil');
  cek('mahasiswa lain TIDAK menerima', (await eDewi) === null);

  cek('PATCH id tidak ada -> 404', (await http(4103, 'PATCH', '/api/v1/surat/99/status', { status: 'selesai' })).status === 404);
  cek('PATCH status tidak dikenal -> 422', (await http(4103, 'PATCH', '/api/v1/surat/3/status', { status: 'xyz' })).status === 422);
  cek('PATCH transisi terlarang (selesai->diproses) -> 422', (await http(4103, 'PATCH', '/api/v1/surat/2/status', { status: 'diproses' })).status === 422);

  cek('webhook tanpa API key -> 401', (await http(4103, 'POST', '/api/v1/webhook/status-surat', { data: { nim: '2201004', status: 'selesai' } })).status === 401);
  cek('webhook data tidak lengkap -> 422', (await http(4103, 'POST', '/api/v1/webhook/status-surat', { data: {} }, { 'X-API-Key': 'kunci-uji' })).status === 422);

  const wDewi = tunggu(dewi, 'surat:status');
  const wSiti = tunggu(siti, 'surat:status', 400);
  const wh = await http(4103, 'POST', '/api/v1/webhook/status-surat',
    { data: { id: 4, nomor: 'SRT/0004/2026', nama: 'Dewi Lestari', nim: '2201004', status: 'diproses', catatan: 'Dari sistem lain' } },
    { 'X-API-Key': 'kunci-uji' });
  cek('webhook valid -> 202', wh.status === 202);
  const nd = await wDewi;
  cek('webhook diteruskan ke pemilik surat', nd?.sumber === 'webhook' && nd?.status_label === 'Diproses');
  cek('webhook tidak bocor ke mahasiswa lain', (await wSiti) === null);

  for (const s of [admin, siti, dewi]) s.close();
}

console.log(`\nHASIL: ${ok} OK, ${gagal} GAGAL`);
rmSync(tmp, { recursive: true, force: true });
process.exit(gagal === 0 ? 0 : 1);
