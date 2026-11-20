// CLIENT chat. Fungsi io() berasal dari /socket.io/socket.io.js
const $ = (s) => document.querySelector(s);

let socket = null;
let namaSaya = '';
let roomAktif = null;
let tujuanPribadi = null;   // Latihan 2: null = kirim ke room

// ---------- 1. Masuk: kirim nama lewat "auth" (dibaca middleware server) ----------
$('#masuk').addEventListener('submit', (e) => {
  e.preventDefault();
  namaSaya = $('#nama').value.trim();
  socket = io({ auth: { nama: namaSaya } });     // reconnect otomatis sudah bawaan
  pasangEvent();
});

function pasangEvent() {
  // ---------- 2. Status koneksi ----------
  socket.on('connect', () => {
    $('#masuk').hidden = true;
    $('#chat').hidden = false;
    setKoneksi('terhubung', true);
    if (roomAktif) gabung(roomAktif);            // setelah reconnect, masuk lagi ke room terakhir
  });
  socket.on('connect_error', (err) => {
    if (!socket.active) {                        // ditolak middleware: tidak mencoba ulang
      $('#errorMasuk').textContent = err.message;
      $('#errorMasuk').hidden = false;
      socket = null;
    } else {
      setKoneksi('menyambung ulang...', false);
    }
  });
  socket.on('disconnect', () => setKoneksi('terputus, menyambung ulang...', false));

  // ---------- 3. Data dari server ----------
  socket.on('rooms', (rooms) => {
    $('#rooms').replaceChildren(...rooms.map((room) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '#' + room;
      b.dataset.room = room;
      b.addEventListener('click', () => gabung(room));
      return b;
    }));
    if (!roomAktif) gabung(rooms[0]);
  });
  socket.on('chat', tampilkanPesan);
  socket.on('pribadi', (p) => {
    const saya = p.dari === namaSaya;
    tampilkanPesan({ nama: saya ? `Anda → ${p.tujuan}` : `${p.dari} (pribadi)`, text: p.text, waktu: p.waktu }, 'pribadi' + (saya ? ' saya' : ''));
  });
  socket.on('sistem', (p) => tambahBaris(p.text, 'sistem'));
  socket.on('online', (daftar) => {
    $('#online').replaceChildren(...daftar.map((n) => {
      const li = document.createElement('li');
      li.textContent = n === namaSaya ? `${n} (Anda)` : n;
      li.classList.toggle('tujuan', n === tujuanPribadi);
      if (n !== namaSaya) li.addEventListener('click', () => pilihTujuan(n));
      return li;
    }));
  });

  const sedangMengetik = new Set();
  socket.on('mengetik', ({ nama, aktif }) => {
    aktif ? sedangMengetik.add(nama) : sedangMengetik.delete(nama);
    $('#mengetik').textContent = sedangMengetik.size ? [...sedangMengetik].join(', ') + ' sedang mengetik...' : '';
  });
}

// ---------- 4. Bergabung ke room: emit dengan ACK ----------
function gabung(room) {
  socket.emit('join', room, (res) => {
    if (!res.ok) return alertSistem(res.message);
    roomAktif = room;
    $('#judulRoom').textContent = '#' + room;
    document.querySelectorAll('#rooms button').forEach((b) => b.classList.toggle('aktif', b.dataset.room === room));
    $('#pesan').replaceChildren();
    res.riwayat.forEach((p) => tampilkanPesan(p));
    $('#teks').focus();
  });
}

function pilihTujuan(nama) {
  tujuanPribadi = tujuanPribadi === nama ? null : nama;   // klik lagi = batal
  $('#tujuanInfo').textContent = tujuanPribadi ? `Pribadi ke ${tujuanPribadi}` : '';
  document.querySelectorAll('#online li').forEach((li) => {
    li.classList.toggle('tujuan', li.textContent === tujuanPribadi);
  });
}

// ---------- 5. Mengirim pesan, menunggu ack maksimal 5 detik ----------
$('#kirim').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#teks').value.trim();
  if (!text) return;
  $('#teks').value = '';
  socket.emit('mengetik', false);

  const event = tujuanPribadi ? 'pribadi' : 'chat';
  const data = tujuanPribadi ? { tujuan: tujuanPribadi, text } : text;
  socket.timeout(5000).emit(event, data, (err, res) => {
    if (err) return alertSistem('Server tidak membalas. Pesan mungkin tidak terkirim.');
    if (!res.ok) alertSistem(res.message);
  });
});

// ---------- 6. Indikator mengetik: berhenti setelah 1,5 detik diam ----------
let timerMengetik = null;
$('#teks').addEventListener('input', () => {
  if (!timerMengetik) socket.emit('mengetik', true);
  clearTimeout(timerMengetik);
  timerMengetik = setTimeout(() => {
    socket.emit('mengetik', false);
    timerMengetik = null;
  }, 1500);
});

// ---------- Tampilan ----------
function tampilkanPesan(p, kelas = '') {
  const li = document.createElement('li');
  li.className = kelas || (p.nama === namaSaya ? 'saya' : '');
  const kepala = document.createElement('small');
  kepala.textContent = `${p.nama} · ${new Date(p.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
  const isi = document.createElement('p');
  isi.textContent = p.text;                       // textContent, BUKAN innerHTML: mencegah XSS
  li.append(kepala, isi);
  $('#pesan').append(li);
  li.scrollIntoView({ block: 'end' });
}

function tambahBaris(text, kelas) {
  const li = document.createElement('li');
  li.className = kelas;
  li.textContent = text;
  $('#pesan').append(li);
  li.scrollIntoView({ block: 'end' });
}

function alertSistem(text) { tambahBaris('⚠ ' + text, 'sistem error'); }

function setKoneksi(text, ok) {
  $('#koneksi').textContent = text;
  $('#koneksi').classList.toggle('ok', ok);
}
