'use strict';
// 公開サイトの HTML。サーバー側で組み立てて返すので表示が速く、検索エンジンにも載る。
// 在庫が変わると site.js が #live の中身だけを差し替える。
const { STATUSES } = require('./db');
const items = require('./items');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = (n) => `¥${Number(n).toLocaleString('ja-JP')}`;
const SEX_MARK = { オス: '♂ オス', メス: '♀ メス', ペア: '♂♀ ペア', 不明: '性別不明' };

function priceHtml(it, cls = 'price') {
  if (it.price_ask) return `<span class="${cls} ask">ASK<small>価格はお問い合わせください</small></span>`;
  if (it.price == null) return `<span class="${cls} ask">お問い合わせ</span>`;
  return `<span class="${cls}">${yen(it.price)}<small>（税込）</small></span>`;
}

const PLACEHOLDER = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 40c6-10 16-14 26-12 6 1 10 5 12 9-4-2-8-2-11 0 3 1 5 3 6 6-6-3-13-3-19 0-5 2-10 2-14-3z" fill="currentColor" opacity=".35"/><circle cx="46" cy="33" r="1.6" fill="currentColor" opacity=".5"/></svg>`;

function card(it) {
  const photo = it.photos[0];
  const sold = it.status === 'sold';
  return `<a class="card${sold ? ' is-sold' : ''}" href="/item/${encodeURIComponent(it.no)}" data-no="${esc(it.no)}">
    <div class="thumb">${photo ? `<img src="${esc(photo)}" alt="${esc(it.species)} ${esc(it.morph)}" loading="lazy" decoding="async">` : PLACEHOLDER}
      ${sold ? '<span class="sold-band">売約済み</span>' : items.isNew(it) ? '<span class="badge-new">New</span>' : ''}
    </div>
    <div class="card-body">
      <p class="card-cat">${esc(it.category || '生体')}<span class="card-no">No.${esc(it.no)}</span></p>
      <h3 class="card-title">${esc(it.species)}</h3>
      ${it.morph ? `<p class="card-morph">${esc(it.morph)}</p>` : ''}
      <p class="card-meta">${[SEX_MARK[it.sex] || it.sex, it.size, it.origin].filter(Boolean).map(esc).join('<span>・</span>')}</p>
      ${sold ? '<span class="price sold">売約済み</span>' : priceHtml(it)}
    </div>
  </a>`;
}

function contactButtons(s, no) {
  const btns = [];
  if (s.lineUrl) btns.push(`<a class="btn btn-line" href="${esc(s.lineUrl)}" target="_blank" rel="noopener">LINEで問い合わせ</a>`);
  if (s.phone) btns.push(`<a class="btn btn-tel" href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">電話する ${esc(s.phone)}</a>`);
  if (!btns.length) return '';
  return `<div class="contact">${no ? `<p class="contact-lead">お問い合わせの際は<strong>「No.${esc(no)}」</strong>とお伝えください。</p>` : ''}<div class="contact-btns">${btns.join('')}</div></div>`;
}

// 帯メニューのアイコン（今のサイトと同じく白い線画）
const ICONS = {
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  stock: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  new: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"/>',
  shop: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  line: '<path d="M12 4C7 4 3 7.2 3 11.2c0 3.6 3.2 6.6 7.5 7.1l-.5 2.7 3.4-2.6c4.3-.4 7.6-3.4 7.6-7.2C21 7.2 17 4 12 4z"/>',
  tel: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  buyback: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  x: '<path d="M4 4l16 16M20 4 4 20"/>',
  insta: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
};

// X（旧Twitter）・Instagram へのリンク
function snsLinks(s, cls = 'sns') {
  const links = [
    s.twitterUrl && `<a class="sns-x" href="${esc(s.twitterUrl)}" target="_blank" rel="noopener">${icon('x')}<span>X（旧Twitter）<small>最新情報はこちら</small></span></a>`,
    s.instagramUrl && `<a class="sns-insta" href="${esc(s.instagramUrl)}" target="_blank" rel="noopener">${icon('insta')}<span>Instagram<small>生体の写真を投稿中</small></span></a>`,
  ].filter(Boolean);
  return links.length ? `<div class="${cls}">${links.join('')}</div>` : '';
}

// 設定の文章を段落と箇条書きにする（「・」で始まる行が箇条書き）
function richText(text) {
  const out = [];
  let list = [];
  const flush = () => { if (list.length) out.push(`<ul>${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`); list = []; };
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (/^[・•\-]/.test(t)) list.push(t.replace(/^[・•\-]\s*/, ''));
    else { flush(); if (t) out.push(`<p>${esc(t)}</p>`); }
  }
  flush();
  return out.join('');
}
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function layout(s, { title, description, body, path = '/', image }) {
  const nav = [['/', 'トップ', 'home'], ['/stock', '在庫一覧', 'stock'], ['/stock?sort=new', '新入荷', 'new'], ['/kaitori', '買取・下取り', 'buyback'], ['/shop', 'アクセス・営業時間', 'shop']]
    .map(([href, label, ic]) => `<a href="${href}"${(href === '/' ? path === '/' : href === '/stock' ? path.startsWith('/stock') || path.startsWith('/item') : path === href) ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`).join('');
  const hbtns = [
    s.lineUrl && `<a class="hbtn" href="${esc(s.lineUrl)}" target="_blank" rel="noopener">${icon('line')}<span>LINEで<br>お問合せ</span></a>`,
    s.phone && `<a class="hbtn" href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${icon('tel')}<span>電話での<br>お問合せ</span></a>`,
  ].filter(Boolean).join('');
  const fullTitle = title ? `${title} | ${s.shopName}` : `${s.shopName} | ${s.tagline}`;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || `${s.shopName}の最新在庫と価格。在庫状況はリアルタイムで更新しています。`)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:type" content="website">
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<meta name="theme-color" content="#55bc6a">
<link rel="icon" href="/img/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/site.css?v=1">
<script src="/js/site.js?v=1" defer></script>
</head>
<body>
${s.notice ? `<div class="notice"><div class="wrap">${esc(s.notice)}</div></div>` : ''}
<header class="site-header">
  <div class="wrap header-inner">
    <a class="logo" href="/"><img src="/img/logo.png" alt="${esc(s.shopName)}" width="268" height="64"></a>
    <div class="hbtns">${hbtns}</div>
  </div>
</header>
<nav class="gnav" aria-label="メニュー"><div class="wrap gnav-inner">${nav}</div></nav>
<main id="live">${body}</main>
<footer class="site-footer">
  <div class="wrap">
    <p class="foot-buy">ご購入は店舗、またはイベント会場にてお願いいたします。</p>
    <p class="foot-links"><a href="/stock">在庫一覧</a><a href="/kaitori">生体の買取・下取り</a><a href="/shop">アクセス・営業時間</a>${s.twitterUrl ? `<a href="${esc(s.twitterUrl)}" target="_blank" rel="noopener">X（旧Twitter）</a>` : ''}${s.instagramUrl ? `<a href="${esc(s.instagramUrl)}" target="_blank" rel="noopener">Instagram</a>` : ''}</p>
    ${legalHtml(s)}
    <p class="copy">© ${new Date().getFullYear()} ${esc(s.shopName)}</p>
  </div>
</footer>
<div class="live-pill" id="livePill" hidden><span class="dot"></span><span id="liveText">在庫をリアルタイム表示中</span></div>
</body>
</html>`;
}

// 動物取扱業の標識（法定表示）
function legalHtml(s) {
  const rows = [
    ['氏名又は名称', s.bizName || s.shopName],
    ['事業所の名称', s.shopName],
    ['事業所の所在地', String(s.address || '').split('\n')[0]], // 2行目以降（駅からの道順など）は載せない
    ['動物取扱業の種別', s.regType],
    ['登録番号', s.regNo],
    ['登録年月日', s.regDate],
    ['有効期間の末日', s.regExpiry],
    ['動物取扱責任者', s.manager],
  ].filter(([, v]) => v);
  if (!s.regNo) return '';
  return `<dl class="legal"><dt class="legal-title">第一種動物取扱業者の表示</dt>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

const updatedAt = () => new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });

function home(s) {
  const fresh = items.listNewArrivals(12);
  const counts = items.countsPublic();
  const total = counts.filter((c) => c.category !== '__sold').reduce((a, c) => a + c.n, 0);
  const cats = s.categories.map((c) => [c, counts.find((x) => x.category === c)?.n || 0]);
  const body = `
  <section class="wrap intro">
    <h1 class="intro-title">${esc(s.tagline)}</h1>
    ${s.intro ? `<p class="intro-text">${esc(s.intro)}</p>` : ''}
    <div class="counter">
      <p class="counter-num"><span>ただいまの販売中</span><strong>${total}</strong>匹</p>
      <p class="updated">在庫はリアルタイムで更新しています・最終更新 <time>${updatedAt()}</time></p>
      <a class="btn btn-primary" href="/stock">在庫一覧を見る</a>
    </div>
  </section>

  <section class="wrap section">
    <div class="section-head"><h2>新入荷</h2><a href="/stock?sort=new">すべて見る →</a></div>
    ${fresh.length ? `<div class="grid">${fresh.map(card).join('')}</div>` : '<p class="empty">現在、新着の生体はありません。</p>'}
  </section>

  <section class="wrap section">
    <div class="section-head"><h2>種類から探す</h2></div>
    <div class="cat-tiles">${cats.map(([c, n]) => `<a href="/stock?category=${encodeURIComponent(c)}"><span>${esc(c)}</span><b>${n}</b></a>`).join('')}</div>
  </section>

  <section class="wrap section buy">
    <h2>ご購入について</h2>
    <p>ご購入は<strong>店舗、またはイベント会場</strong>にてお願いいたします。<br>在庫・生体についてのお問い合わせはLINEまたはお電話でどうぞ。</p>
    ${contactButtons(s)}
    ${s.eventInfo ? `<div class="event"><h3>イベント出店情報</h3><p>${esc(s.eventInfo).replace(/\n/g, '<br>')}</p></div>` : ''}
  </section>

  ${s.twitterUrl || s.instagramUrl ? `<section class="wrap section">
    <div class="section-head"><h2>最新情報はSNSで</h2></div>
    ${snsLinks(s)}
  </section>` : ''}

  <section class="wrap section">
    <div class="section-head"><h2>生体の買取・下取り</h2><a href="/kaitori">詳しく見る →</a></div>
    <p class="lead-box">飼育できなくなった生体や、ご自宅で繁殖させた生体の買取・下取りを行っています。まずはLINEかお電話でご相談ください。</p>
  </section>

  <section class="wrap section">
    <div class="section-head"><h2>アクセス・営業時間</h2><a href="/shop">詳しく見る →</a></div>
    ${shopTable(s)}
  </section>`;
  return layout(s, { body, path: '/' });
}

function shopTable(s) {
  const rows = [['住所', s.address], ['営業時間', s.hours], ['定休日', s.holidays], [s.phone2 ? '電話（爬虫類の在庫・買取）' : '電話', s.phone],
    [`電話（${s.phone2Label || 'その他'}）`, s.phone2], ['LINE', s.lineId]].filter(([, v]) => v);
  return rows.length ? `<dl class="shop-table">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v).replace(/\n/g, '<br>')}</dd></div>`).join('')}</dl>` : '<p class="empty">店舗情報は準備中です。</p>';
}

function stock(s, query) {
  const q = String(query.q || '').slice(0, 50);
  const category = s.categories.includes(query.category) ? query.category : '';
  const showSold = query.sold !== '0';
  const sort = ['new', 'price_asc', 'price_desc', 'name'].includes(query.sort) ? query.sort : 'new';
  const list = items.listPublic({ category, q, sort, status: showSold ? '' : 'available' });
  const counts = items.countsPublic();
  const total = counts.filter((c) => c.category !== '__sold').reduce((a, c) => a + c.n, 0);
  const qs = (patch) => {
    const p = new URLSearchParams({ ...(category && { category }), ...(q && { q }), ...(sort !== 'new' && { sort }), ...(!showSold && { sold: '0' }), ...patch });
    for (const [k, v] of [...p]) if (v === '') p.delete(k);
    const str = p.toString();
    return `/stock${str ? `?${str}` : ''}`;
  };
  const chips = [['', `すべて ${total}`], ...s.categories.map((c) => [c, `${c} ${counts.find((x) => x.category === c)?.n || 0}`])]
    .map(([c, label]) => `<a class="chip"${c === category ? ' aria-current="true"' : ''} href="${qs({ category: c })}">${esc(label)}</a>`).join('');
  const available = list.filter((i) => i.status === 'available').length;
  const body = `
  <section class="wrap section">
    <p class="crumbs"><a href="/">ホーム</a> &gt; ${category ? `<a href="/stock">在庫一覧</a> &gt; ${esc(category)}` : '在庫一覧'}</p>
    <h1 class="page-title">${category ? `${esc(category)}の在庫` : '在庫一覧'}</h1>
    <p class="page-lead">在庫状況はリアルタイムで更新しています。<span class="updated">最終更新 <time>${updatedAt()}</time></span></p>
    <form class="filters" action="/stock" method="get">
      ${category ? `<input type="hidden" name="category" value="${esc(category)}">` : ''}
      <input class="search" type="search" name="q" value="${esc(q)}" placeholder="種名・モルフ・管理番号で検索" enterkeyhint="search">
      <select name="sort" onchange="this.form.submit()" aria-label="並び替え">
        ${[['new', '新着順'], ['price_asc', '価格の安い順'], ['price_desc', '価格の高い順'], ['name', '種名順']].map(([v, l]) => `<option value="${v}"${v === sort ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
      <label class="toggle"><input type="checkbox" name="sold" value="0"${showSold ? '' : ' checked'} onchange="this.form.submit()"> 販売中のみ</label>
    </form>
    <nav class="chips" aria-label="種類">${chips}</nav>
    <p class="result-count">${available} 匹 販売中${list.length > available ? `／売約済み ${list.length - available} 匹` : ''}</p>
    ${list.length ? `<div class="grid">${list.map(card).join('')}</div>` : '<p class="empty">条件に合う生体は現在ありません。</p>'}
  </section>`;
  return layout(s, { title: category ? `${category}の在庫` : '在庫一覧', body, path: '/stock' });
}

function detail(s, it) {
  const sold = it.status === 'sold';
  const rows = [['管理番号', `No.${it.no}`], ['種類', it.category], ['種名', it.species], ['モルフ', it.morph], ['性別', SEX_MARK[it.sex] || it.sex],
    ['サイズ', it.size], ['CB/WB・産地', it.origin], ['ハッチ日・生年月日', it.birth], ['入荷日', it.arrived_at]].filter(([, v]) => v);
  const photos = it.photos.length ? it.photos : [null];
  const body = `
  <section class="wrap section detail">
    <p class="crumbs"><a href="/">ホーム</a> &gt; ${it.category ? `<a href="/stock?category=${encodeURIComponent(it.category)}">${esc(it.category)}</a>` : '<a href="/stock">在庫一覧</a>'} &gt; ${esc(it.species)} ${esc(it.morph)}</p>
    <div class="detail-grid">
      <div class="gallery">
        <div class="gallery-main${sold ? ' is-sold' : ''}">${photos[0] ? `<img src="${esc(photos[0])}" alt="${esc(it.species)}" id="mainPhoto">` : PLACEHOLDER}${sold ? '<span class="sold-band">売約済み</span>' : ''}</div>
        ${photos.length > 1 ? `<div class="gallery-thumbs">${photos.map((p, i) => `<button type="button" data-src="${esc(p)}"${i === 0 ? ' aria-current="true"' : ''}><img src="${esc(p)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
      </div>
      <div class="detail-info">
        <p class="status-tag status-${it.status}">${STATUSES[it.status]}${!sold && items.isNew(it) ? ' <span class="badge-new">New</span>' : ''}</p>
        <h1>${esc(it.species)}${it.morph ? `<span>${esc(it.morph)}</span>` : ''}</h1>
        <div class="detail-price">${sold ? '<span class="price sold">売約済み</span>' : `<span class="price-label">販売価格</span>${priceHtml(it, 'price big')}`}</div>
        <dl class="spec">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        ${it.note ? `<p class="note">${esc(it.note).replace(/\n/g, '<br>')}</p>` : ''}
        ${sold ? '<p class="sold-msg">この生体は売約済みとなりました。ほかの在庫もぜひご覧ください。</p>' : `<p class="buy-note">ご購入は店舗、またはイベント会場にてお願いいたします。</p>${contactButtons(s, it.no)}`}
      </div>
    </div>
  </section>`;
  return layout(s, { title: `${it.species}${it.morph ? ` ${it.morph}` : ''}`, description: `${it.species} ${it.morph} ${it.price_ask ? '' : it.price ? yen(it.price) : ''} — ${s.shopName}`, body, path: '/stock', image: it.photos[0] });
}

function shop(s) {
  const body = `
  <section class="wrap section">
    <p class="crumbs"><a href="/">ホーム</a> &gt; アクセス・営業時間</p>
    <h1 class="page-title">アクセス・営業時間</h1>
    ${shopTable(s)}
    ${s.mapUrl ? `<div class="map"><iframe src="${esc(s.mapUrl)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="地図"></iframe></div>` : ''}
    <div class="buy"><h2>ご購入について</h2><p>ご購入は<strong>店舗、またはイベント会場</strong>にてお願いいたします。</p>${contactButtons(s)}</div>
    ${s.eventInfo ? `<div class="event"><h2>イベント出店情報</h2><p>${esc(s.eventInfo).replace(/\n/g, '<br>')}</p></div>` : ''}
    ${snsLinks(s)}
  </section>`;
  return layout(s, { title: 'アクセス・営業時間', body, path: '/shop' });
}

function buyback(s) {
  const body = `
  <section class="wrap section">
    <p class="crumbs"><a href="/">ホーム</a> &gt; 生体の買取・下取り</p>
    <h1 class="page-title">生体の買取・下取り</h1>
    <div class="rich">${richText(s.buyback)}</div>
    <div class="buy"><h2>買取・下取りのご相談</h2><p>「種類・性別・状態・写真」を添えてご連絡ください。</p>${contactButtons(s)}</div>
    ${shopTable(s)}
  </section>`;
  return layout(s, { title: '生体の買取・下取り', description: `${s.shopName}の生体の買取・下取りのご案内`, body, path: '/kaitori' });
}

function notFound(s) {
  return layout(s, { title: 'ページが見つかりません', body: `<section class="wrap section"><h1 class="page-title">お探しの生体・ページは見つかりませんでした</h1><p>売約済みから日数が経ったか、掲載を終了した可能性があります。</p><p><a class="btn btn-primary" href="/stock">在庫一覧へ</a></p></section>` });
}

module.exports = { home, stock, detail, shop, buyback, notFound, esc };
