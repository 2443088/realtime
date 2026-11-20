import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const PORT = Number(process.env.CHAT_PORT ?? 3002);
const FILE_RIWAYAT = process.env.CHAT_RIWAYAT ?? fileURLToPath(new URL('./riwayat.json', import.meta.url));
const ROOMS = ['umum', 'ti-5a', 'ti-5b'];
const MAKS_RIWAYAT = 50;
const MAKS_PESAN = 5;        // Latihan 1: maksimal 5 pesan ...
const JENDELA_MS = 10_000;   // ... per 10 detik

const app = express();
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
const server = createServer(app);   // Express dan Socket.IO berbagi satu HTTP server
const io = new Server(server);      // juga menyajikan /socket.io/socket.io.js

// Latihan 3: riwayat disimpan ke file JSON, dimuat lagi saat server start.
// shortcut: tulis sinkron seluruh file tiap pesan, ganti ke database jika trafik tinggi.
const riwayat = new Map(ROOMS.map((room) => [room, []]));
try {
  const tersimpan = JSON.parse(readFileSync(FILE_RIWAYAT, 'utf8'));
  for (const room of ROOMS) riwayat.set(room, Array.isArray(tersimpan[room]) ? tersimpan[room] : []);
} catch { /* file belum ada atau rusak: mulai kosong */ }

function simpanRiwayat() {
  writeFileSync(FILE_RIWAYAT, JSON.stringify(Object.fromEntries(riwayat)));
}

/** Latihan 1: true jika socket ini sudah mencapai batas kirim pada jendela waktu. */
function terlaluCepat(socket) {
  const sekarang = Date.now();
  const waktu = (socket.data.waktuKirim ??= []).filter((t) => sekarang - t < JENDELA_MS);
  socket.data.waktuKirim = waktu;
  if (waktu.length >= MAKS_PESAN) return true;
  waktu.push(sekarang);
  return false;
}

// ---------- MIDDLEWARE: dijalankan saat client mencoba terhubung ----------
io.use((socket, next) => {
  const nama = String(socket.handshake.auth?.nama ?? '').trim();
  if (nama.length < 2 || nama.length > 20) {
    return next(new Error('Nama harus 2-20 karakter.'));  // client menerima connect_error
  }
  socket.data.nama = nama;
  next();
});

io.on('connection', (socket) => {
  const { nama } = socket.data;
  console.log(`[+] ${nama} terhubung (${socket.id})`);

  socket.join('user:' + nama);   // Latihan 2: "kotak surat" pribadi
  socket.emit('rooms', ROOMS);

  // ---------- Bergabung ke room. "ack" = callback balasan ke pengirim ----------
  socket.on('join', async (room, ack) => {
    if (typeof ack !== 'function') return;
    if (!ROOMS.includes(room)) return ack({ ok: false, message: 'Room tidak ditemukan.' });

    const lama = socket.data.room;
    if (lama === room) return ack({ ok: true, riwayat: riwayat.get(room) });
    if (lama) {
      socket.leave(lama);
      kirimSistem(lama, `${nama} pindah ke #${room}`);
      await kirimOnline(lama);
    }
    socket.join(room);
    socket.data.room = room;
    ack({ ok: true, riwayat: riwayat.get(room) });   // riwayat untuk yang baru masuk
    kirimSistem(room, `${nama} bergabung`);
    await kirimOnline(room);
  });

  // ---------- Pesan chat ----------
  socket.on('chat', (teks, ack) => {
    if (typeof ack !== 'function') ack = () => {};
    const room = socket.data.room;
    const text = String(teks ?? '').trim();
    if (!room) return ack({ ok: false, message: 'Pilih room terlebih dahulu.' });
    if (text === '' || text.length > 500) return ack({ ok: false, message: 'Pesan harus 1-500 karakter.' });
    if (terlaluCepat(socket)) return ack({ ok: false, message: 'Terlalu cepat, tunggu sebentar.' });

    const pesan = { id: randomUUID(), room, nama, text, waktu: new Date().toISOString() };
    const daftar = riwayat.get(room);
    daftar.push(pesan);
    if (daftar.length > MAKS_RIWAYAT) daftar.shift();
    simpanRiwayat();

    io.to(room).emit('chat', pesan);   // ke SEMUA anggota room, termasuk pengirim
    ack({ ok: true, id: pesan.id });   // konfirmasi ke pengirim
  });

  // ---------- Latihan 2: pesan pribadi, hanya diterima tujuan (dan pengirim) ----------
  socket.on('pribadi', async (data, ack) => {
    if (typeof ack !== 'function') ack = () => {};
    const tujuan = String(data?.tujuan ?? '').trim();
    const text = String(data?.text ?? '').trim();
    if (text === '' || text.length > 500) return ack({ ok: false, message: 'Pesan harus 1-500 karakter.' });
    if ((await io.in('user:' + tujuan).fetchSockets()).length === 0) {
      return ack({ ok: false, message: 'Pengguna tidak online.' });
    }
    if (terlaluCepat(socket)) return ack({ ok: false, message: 'Terlalu cepat, tunggu sebentar.' });

    const pesan = { id: randomUUID(), dari: nama, tujuan, text, waktu: new Date().toISOString() };
    io.to('user:' + tujuan).to('user:' + nama).emit('pribadi', pesan);  // 2 room, tanpa duplikat
    ack({ ok: true, id: pesan.id });
  });

  // ---------- Mengetik: ke anggota room LAIN (bukan pengirim) ----------
  socket.on('mengetik', (aktif) => {
    if (socket.data.room) socket.to(socket.data.room).emit('mengetik', { nama, aktif: Boolean(aktif) });
  });

  socket.on('disconnect', async (alasan) => {
    console.log(`[-] ${nama} putus: ${alasan}`);
    const room = socket.data.room;
    if (room) {
      kirimSistem(room, `${nama} keluar`);
      await kirimOnline(room);
    }
  });
});

function kirimSistem(room, text) {
  io.to(room).emit('sistem', { text, waktu: new Date().toISOString() });
}

/** Kirim daftar nama yang sedang ada di room. */
async function kirimOnline(room) {
  const sockets = await io.in(room).fetchSockets();
  io.to(room).emit('online', sockets.map((s) => s.data.nama));
}

server.listen(PORT, () => console.log(`02 Chat Socket.IO -> http://localhost:${PORT}`));

export { server, io };
