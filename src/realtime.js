'use strict';
// Server-Sent Events。在庫が変わった瞬間に、開いている公開ページと
// スタッフアプリ全員へ「何番が変わったか」だけを送る（データ量は数十バイト）。
const clients = new Set();

function subscribe(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx 越しでもバッファさせない
  });
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

module.exports = { subscribe, broadcast, clients };
