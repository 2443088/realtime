import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { STATUS, statusValid, bisaBerubah, tampil } from './status.js';

const PORT = Number(process.env.NOTIF_PORT ?? 3003);
const API_KEY = process.env.API_KEY ?? 'rahasia-demo';

const app = express();
app.use(express.json());
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
const server = createServer(app);
const io = new Server(server);

// Data contoh di memori (mengikuti seeder pertemuan 9: Andi = 2201001, Siti = 2201002)
const data = [
  { id: 1, nomor: 'SRT/0001/2026', nama: 'Andi Pratama',  nim: '2201001', status: 'selesai' },
  { id: 2, nomor: 'SRT/0002/2026', nama: 'Siti Rahma',    nim: '2201002', status: 'diproses' },
  { id: 3, nomor: 'SRT/0003/2026', nama: 'Budi Hartono',  nim: '2201003', status: 'diajukan' },
  { id: 4, nomor: 'SRT/0004/2026', nama: 'Dewi Lestari',  nim: '2201004', status: 'diajukan' },
  { id: 5, nomor: 'SRT/0005/2026', nama: 'Eko Saputra',   nim: '2201005', status: 'diproses' },
];

// Client memilih "kanal" yang ingin didengar
io.on('connection', (socket) => {
  socket.on('gabung', (info, ack) => {
    const balas = typeof ack === 'function' ? ack : () => {};
    const { peran, nim } = info ?? {};
    if (peran === 'admin') {
      socket.join('admin');
    } else if (peran === 'mahasiswa' && /^\d{5,15}$/.test(String(nim))) {
      socket.join(`mhs:${nim}`);
    } else {
      return balas({ ok: false, message: 'Peran harus admin, atau mahasiswa dengan NIM yang valid.' });
    }
    balas({ ok: true, rooms: [...socket.rooms].filter((r) => r !== socket.id) });
  });
});

/** Kirim event ke admin dan ke mahasiswa pemilik surat saja. */
function siarkan(info) {
  const event = { ...info, waktu: new Date().toISOString() };
  io.to('admin').to(`mhs:${info.nim}`).emit('surat:status', event);  // 2 room, tanpa duplikat
}

// REST: baca data (dipakai ulang oleh halaman setelah menerima notifikasi)
app.get('/api/v1/surat', (req, res) => {
  const daftar = req.query.nim ? data.filter((s) => s.nim === String(req.query.nim)) : data;
  res.json({ data: daftar.map(tampil) });
});

// REST: perubahan data tetap lewat HTTP
app.patch('/api/v1/surat/:id/status', (req, res) => {
  const surat = data.find((s) => s.id === Number(req.params.id));
  if (!surat) return res.status(404).json({ message: 'Data tidak ditemukan.' });

  const { status, catatan = '' } = req.body ?? {};
  if (!statusValid(status)) {
    return res.status(422).json({ message: 'Status tidak dikenal.', errors: { status: ['Status tidak dikenal.'] } });
  }
  if (!bisaBerubah(surat.status, status)) {
    const pesan = `Status ${STATUS[surat.status].label} tidak bisa diubah ke ${STATUS[status].label}.`;
    return res.status(422).json({ message: pesan, errors: { status: [pesan] } });
  }

  surat.status = status;
  siarkan({ ...tampil(surat), catatan: String(catatan).trim(), sumber: 'dashboard' });
  res.json({ data: tampil(surat) });
});

// Webhook dari sistem lain (format sama dengan NotifikasiService Laravel pertemuan 6)
app.post('/api/v1/webhook/status-surat', (req, res) => {
  if (req.get('X-API-Key') !== API_KEY) return res.status(401).json({ message: 'API key tidak valid.' });

  const d = req.body?.data;
  if (!d?.nim || !statusValid(d.status)) {
    return res.status(422).json({ message: 'Data webhook tidak lengkap (butuh data.nim dan data.status).' });
  }
  siarkan({ id: d.id, nomor: d.nomor, nama: d.nama, nim: String(d.nim), status: d.status,
            status_label: STATUS[d.status].label, catatan: d.catatan ?? '', sumber: 'webhook' });
  res.status(202).json({ message: 'Notifikasi diteruskan ke client.' });
});

server.listen(PORT, () => console.log(`03 Notifikasi -> http://localhost:${PORT}/admin.html`));

export { server, io, app };
