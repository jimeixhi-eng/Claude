'use strict';
// Server-Sent Events。在庫が変わった瞬間に、開いている公開ページとスタッフアプリへ小さな通知を送る。
// 公開ページ向け（/events）には管理番号を含めず、公開用コードだけを送る。管理番号はログイン済みのスタッフ（/api/events）にだけ届く。
const clients = new Map(); // res → { staff: boolean }

function subscribe(req, res, { staff = false } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx 越しでもバッファさせない
  });
  res.write('retry: 3000\n\n');
  clients.set(res, { staff });
  const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

// data はスタッフ向け、publicData は公開ページ向け（省略時は同じものを送る）
function broadcast(event, data, publicData = data) {
  const staffMsg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const publicMsg = `event: ${event}\ndata: ${JSON.stringify(publicData)}\n\n`;
  for (const [res, { staff }] of clients) res.write(staff ? staffMsg : publicMsg);
}

module.exports = { subscribe, broadcast, clients };
