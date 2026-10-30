// 公開サイトのリアルタイム更新。
// サーバーから「在庫が変わった」という小さな通知を受けたら、今見ているページの中身だけを取り直して差し替える。
(() => {
  const pill = document.getElementById('livePill');
  const text = document.getElementById('liveText');

  // 詳細ページの写真切り替え
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.gallery-thumbs button');
    if (!b) return;
    const main = document.getElementById('mainPhoto');
    if (main) main.src = b.dataset.src;
    b.parentElement.querySelectorAll('button').forEach((x) => x.toggleAttribute('aria-current', x === b));
  });

  if (!('EventSource' in window)) return;
  let timer = null;
  let changedNos = new Set();

  async function refresh() {
    try {
      const res = await fetch(location.href, { headers: { Accept: 'text/html' }, cache: 'no-store' });
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const next = doc.getElementById('live');
      const cur = document.getElementById('live');
      if (!next || !cur) return;
      // 入力中の検索欄はそのまま残す
      const active = document.activeElement;
      if (active && active.matches('.search') && cur.contains(active)) {
        const q = next.querySelector('.search');
        if (q) q.replaceWith(active);
      }
      cur.replaceWith(next);
      for (const no of changedNos) next.querySelectorAll(`[data-no="${CSS.escape(no)}"]`).forEach((el) => el.classList.add('changed'));
      changedNos = new Set();
      if (pill) { pill.classList.add('flash'); text.textContent = '在庫が更新されました'; setTimeout(() => { pill.classList.remove('flash'); text.textContent = '在庫をリアルタイム表示中'; }, 2500); }
    } catch { /* 通信が戻れば次の通知で更新される */ }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 400); };

  const es = new EventSource('/events');
  es.addEventListener('open', () => { if (pill) { pill.hidden = false; pill.classList.remove('off'); text.textContent = '在庫をリアルタイム表示中'; } });
  es.addEventListener('error', () => { if (pill) { pill.classList.add('off'); text.textContent = '再接続中…'; } });
  es.addEventListener('item', (e) => { try { changedNos.add(JSON.parse(e.data).no); } catch {} schedule(); });
  es.addEventListener('reload', schedule);
  // スマホでタブに戻ってきたときにも最新化
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(); });
})();
