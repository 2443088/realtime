import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.WS_PORT ?? 3001);

// 1. HTTP server biasa: hanya untuk menyajikan halaman client
const server = createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const html = await readFile(new URL('./public/index.html', import.meta.url));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Tidak ditemukan');
});

// 2. WebSocket server MENUMPANG di HTTP server yang sama (handshake "Upgrade")
const wss = new WebSocketServer({ server });
let nomorClient = 0;

wss.on('connection', (ws) => {
  const id = ++nomorClient;
  ws.isAlive = true;
  console.log(`[+] client #${id} terhubung. Online: ${wss.clients.size}`);

  // Server bisa MENGIRIM kapan saja tanpa diminta: bedanya dengan HTTP biasa
  kirim(ws, { type: 'selamat-datang', id, online: wss.clients.size });
  broadcast({ type: 'online', online: wss.clients.size });

  // 3. Menerima pesan. Data mentah (teks/biner); kita sepakati formatnya JSON.
  ws.on('message', (data) => {
    let pesan;
    try {
      pesan = JSON.parse(data.toString());
    } catch {
      return kirim(ws, { type: 'error', message: 'Pesan harus berupa JSON.' });
    }
    if (pesan.type === 'chat' && typeof pesan.text === 'string' && pesan.text.trim() !== '') {
      broadcast({
        type: 'chat',
        dari: id,
        text: pesan.text.trim().slice(0, 500),
        waktu: new Date().toISOString(),
      });
    } else {
      kirim(ws, { type: 'error', message: 'Format: {"type":"chat","text":"..."}' });
    }
  });

  ws.on('pong', () => { ws.isAlive = true; });  // balasan heartbeat

  ws.on('close', (code) => {
    console.log(`[-] client #${id} putus (kode ${code}). Online: ${wss.clients.size}`);
    broadcast({ type: 'online', online: wss.clients.size });
  });
});

// 4. HEARTBEAT: koneksi yang mati diam-diam (wifi putus) tidak memicu close.
//    Setiap 30 detik kirim ping; yang tidak membalas pong diputus.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
wss.on('close', () => clearInterval(heartbeat));

function kirim(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

/** Kirim ke SEMUA client yang terhubung. */
function broadcast(obj) {
  for (const client of wss.clients) kirim(client, obj);
}

server.listen(PORT, () => console.log(`01 WebSocket dasar -> http://localhost:${PORT}`));

export { server, wss };
