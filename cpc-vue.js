/* POLISOL widget v2025-09-06-22  */
/* ecwid-polisol-cost-wholesale — CPC VUE WIDGET (v2025-09-06-22)
   Фиксы:
   - Вернул отсутствующую функцию renderCartSummary() → нет ReferenceError.
   - Не очищаю lock при пост-рендерных ошибках (чтобы не ловить "є товар без lock").
   - Без мерцаний, таблица/панель обновляются только при реальных изменениях.
*/
(() => {
      console.info('POLISOL widget v2025-09-06-22 ready');

      // === Endpoints ===
      const API_BASE = 'https://ecwid-polisol-cost-wholesale.vercel.app';
      const PRICING_ENDPOINT = API_BASE + '/api/polisol/pricing';
      const QUOTE_ENDPOINT = API_BASE + '/api/polisol/quote';

      // === Family/SKU ===
      const FAMILY_PREFIX = 'ПОЛІСОЛ-';

      // === Globals ===
      let pricingCache = null;
      let initialPriceText = null;
      const __cpc = (window.__cpc = window.__cpc || {
            optsBound: false,
            mo: null,
            moScheduled: false,
            warned: new Set(),
            cartBound: false,
            adding: false,
            currentSku: null,
            isTargetMemo: null,
            cssInjected: false,
            summaryFP: null,
            inlineFP: null
      });

      // === Lock ===
      const LOCK_KEY = 'POLISOL_LOCK';
      const getLock = () => { try { return JSON.parse(sessionStorage.getItem(LOCK_KEY) || 'null'); } catch (_) { return null; } };
      const setLock = (o) => { try { sessionStorage.setItem(LOCK_KEY, JSON.stringify(o)); } catch (_) { } };
      const clearLock = () => { try { sessionStorage.removeItem(LOCK_KEY); } catch (_) { } };

      // === Ecwid helpers ===
      function waitEcwid(cb) { (typeof Ecwid !== 'undefined' && Ecwid.OnAPILoaded) ? cb() : setTimeout(() => waitEcwid(cb), 100); }
      function fetchCart() {
            return new Promise((resolve) => {
                  try { Ecwid.Cart.get((cart) => resolve(cart || { items: [] })); }
                  catch (_) { resolve({ items: [] }); }
            });
      }
      const itemSku = (it) => (it && (it.sku || it.productSku || it.product?.sku)) || '';
      const cartHasFamily = (items) => (items || []).some((it) => itemSku(it).indexOf(FAMILY_PREFIX) === 0);
      const sumFamilyQty = (items) => (items || []).reduce((acc, it) => acc + (itemSku(it).indexOf(FAMILY_PREFIX) === 0 ? (Number(it.quantity) || 0) : 0), 0);

      // === Utils ===
      async function ensureVue() {
            try {
                  if (typeof window.Vue === 'object' && window.Vue && window.Vue.createApp) return;
                  await new Promise((res) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/vue@3/dist/vue.global.prod.js'; s.onload = res; s.onerror = () => res(); document.head.appendChild(s); });
            } catch (_) { }
      }
      const formatUAH = (n) => { try { return '₴' + Number(n || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (_) { return '₴' + (Number(n || 0)).toFixed(2); } };
      const replaceAll = (src, what, withWhat) => String(src).split(what).join(withWhat);
      const removeQuotes = (s) => replaceAll(replaceAll(replaceAll(String(s), '«', ''), '»', ''), '"', '');
      function normApos(s) { let r = String(s || ''); r = replaceAll(r, '’', "'"); r = replaceAll(r, 'ʼ', "'"); r = replaceAll(r, '′', "'"); r = replaceAll(r, '´', "'"); return r; }
      const normalizeKey = (s) => removeQuotes(normApos(String(s))).trim().toLowerCase();

      // === Page detection ===
      function getSku() {
            const sels = ['[itemprop="sku"]', '.product-details__product-sku', '[data-product-sku]', '.product-details__sku', '.details-product-code__value', '.ec-store__product-sku', '.ecwid-productBrowser-sku'];
            for (const s of sels) {
                  const el = document.querySelector(s); if (!el) continue;
                  const raw = (el.getAttribute('content') || el.textContent || '').trim(); if (!raw) continue;
                  const up = raw.toUpperCase(); const tokens = up.split(' ').filter(Boolean); const filtered = tokens.filter(t => t !== 'SKU');
                  if (filtered.length) return filtered[filtered.length - 1];
            }
            return null;
      }
      function isTargetProduct() {
            if (typeof __cpc.isTargetMemo === 'boolean') return __cpc.isTargetMemo;
            const memo = __cpc.currentSku;
            if (memo) { __cpc.isTargetMemo = memo.indexOf(FAMILY_PREFIX) === 0; return __cpc.isTargetMemo; }
            const sku = getSku() || ''; if (sku) __cpc.currentSku = sku;
            __cpc.isTargetMemo = sku.indexOf(FAMILY_PREFIX) === 0; return __cpc.isTargetMemo;
      }

      // === Batch helpers ===
      function extractAllowedNumber(str, allowed) {
            const a = String(str || ''); let curr = ''; for (let i = 0; i < a.length; i++) {
                  const ch = a[i];
                  if (ch >= '0' && ch <= '9') curr += ch; else if (curr.length) { const v = parseInt(curr, 10); if (allowed.indexOf(v) >= 0) return v; curr = ''; }
            }
            if (curr.length) { const v = parseInt(curr, 10); if (allowed.indexOf(v) >= 0) return v; } return null;
      }
      function findBatchControl() {
            const selects = Array.from(document.querySelectorAll('.form-control__select'));
            for (const s of selects) { const opts = Array.from(s.options || []).map(o => o.textContent || '').join(' '); if (extractAllowedNumber(opts, [15, 30, 45, 60, 75]) != null) return s.closest('.form-control') || null; }
            const controls = Array.from(document.querySelectorAll('.form-control'));
            for (const fc of controls) { const t = (fc.innerText || '').trim(); if (extractAllowedNumber(t, [15, 30, 45, 60, 75]) != null) return fc; }
            return null;
      }
      function readBatchCount() {
            const fc = findBatchControl(); if (!fc) return null; const sel = fc.querySelector('.form-control__select');
            if (sel && sel.value && ['Виберіть', 'Выберите', 'Select'].every(x => sel.value.indexOf(x) < 0)) { const v = extractAllowedNumber(sel.value, [15, 30, 45, 60, 75]); return v != null ? v : null; }
            const txt = (fc.querySelector('.form-control__select-text')?.textContent || fc.textContent || '').trim(); const vv = extractAllowedNumber(txt, [15, 30, 45, 60, 75]); return vv != null ? vv : null;
      }
      const batchCountToIndex = (n) => (n === 15 ? 1 : (n === 30 ? 2 : (n === 45 ? 3 : (n === 60 ? 4 : (n === 75 ? 5 : null)))));
      const batchLimitByIndex = (idx) => (idx === 1 ? 15 : (idx === 2 ? 30 : (idx === 3 ? 45 : (idx === 4 ? 60 : (idx === 5 ? 75 : null)))));

      // === "Вміст" helpers ===
      function canonContent(label) {
            const t = normalizeKey(label); if (!t) return null;
            if (t.indexOf('білий') >= 0) return 'Квас трипільський (білий)';
            if (t.indexOf('коріандр') >= 0) return 'Квас трипільський з коріандром';
            if (t.indexOf('класич') >= 0) return 'Класичний';
            if (t.indexOf('шипшин') >= 0) return 'Шипшина';
            if (t.indexOf('журавлин') >= 0) return 'Журавлина';
            if (t.indexOf('матусин') >= 0 || t.indexOf("матусине здоров'я") >= 0 || t.indexOf('матусине здоров') >= 0) return "Матусине здоров'я";
            if (t.indexOf('чоловіч') >= 0) return 'Чоловіча Сила';
            if (t.indexOf('квас') >= 0) return 'Квас трипільський';
            return null;
      }
      function getItemContentLabel(it) {
            const optLists = [it?.options, it?.selectedOptions, it?.product?.options].filter(Boolean);
            for (const list of optLists) {
                  for (const o of list) {
                        const name = String(o?.name || '').toLowerCase();
                        if (name.includes('вміст')) {
                              const v = removeQuotes(o?.value || '');
                              if (v) return v;
                        }
                  }
            }
            const name = String(it?.name || '');
            const m = name.match(/«([^»]+)»/);
            if (m && m[1]) return removeQuotes(m[1]);
            return canonContent(name) || '';
      }
      function getUnitPrice(it) {
            const cand = [it?.price, it?.product?.price, it?.productPrice, it?.priceWithoutTax, it?.salePrice];
            for (const v of cand) { const n = Number(v); if (isFinite(n) && n > 0) return n; }
            return 0;
      }

      // === Цена (UI) ===
      function priceEls() {
            const span = document.querySelector('.details-product-price__value.ec-price-item');
            const box = document.querySelector('.product-details__product-price.ec-price-item[itemprop="price"]') || document.querySelector('.product-details__product-price.ec-price-item');
            return { span, box };
      }
      function setPriceUI(numOrNull) {
            const { span, box } = priceEls(); if (!span) return;
            if (initialPriceText == null) initialPriceText = span.textContent;
            if (typeof numOrNull === 'number' && Number.isFinite(numOrNull) && numOrNull > 0) { span.textContent = formatUAH(numOrNull); if (box) box.setAttribute('content', String(numOrNull)); }
            else { span.textContent = initialPriceText || '€0'; if (box) box.setAttribute('content', '0'); }
      }
      function refreshUnitPrice() {
            if (!pricingCache || !pricingCache.ok) { setPriceUI(null); return { idx: null, canon: null, price: null }; }
            const bCount = readBatchCount(); const idx = bCount ? batchCountToIndex(bCount) : null;
            const radios = Array.from(document.querySelectorAll('input.form-control__radio')); const r = radios.find(x => x.checked);
            const rawLabel = r ? (document.querySelector('label[for="' + r.id + '"]')?.textContent || r.value || '').trim() : null;
            const canon = rawLabel ? canonContent(rawLabel) : null;

            if (idx && canon) {
                  const key = normalizeKey(canon); const row = (pricingCache.__index && pricingCache.__index[key]) || null;
                  if (!row) { if (!__cpc.warned.has(key)) { console.warn('[POLISOL] price row not found for', canon, 'key=', key, 'available=', Object.keys(pricingCache.__index || {})); __cpc.warned.add(key); } setPriceUI(null); return { idx, canon, price: null }; }
                  const price = row[(idx - 1) | 0] || 0; setPriceUI(price); return { idx, canon, price };
            } else { setPriceUI(null); return { idx: idx || null, canon: canon || null, price: null }; }
      }

      // === Robust quote (contentLabel first) ===
      async function requestQuote({ canon, contentKey, idx }) {
            const attempts = [
                  { payload: { contentLabel: canon, batchIndex: idx }, tag: 'contentLabel' },
                  { payload: { contentKey, batchIndex: idx }, tag: 'contentKey' },
                  { payload: { content: contentKey, batchIndex: idx }, tag: 'content' },
                  { payload: { label: canon, batchIndex: idx }, tag: 'label' },
                  { payload: { name: canon, batchIndex: idx }, tag: 'name' },
            ];
            let lastErr = null;
            for (const { payload, tag } of attempts) {
                  try {
                        const resp = await fetch(QUOTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                        let data = null, text = ''; try { data = await resp.json(); } catch (_) { try { text = await resp.text(); } catch (__) { } }
                        if (!resp.ok || !data || data.ok === false || !data.productId) { const msg = (data && (data.message || data.error || data.err || data.detail)) || text || resp.statusText || 'Unknown error'; lastErr = { status: resp.status, tag, msg, data }; console.warn('[POLISOL] quote failed (' + tag + '):', lastErr); }
                        else { console.info('[POLISOL] quote success via', tag, '→ productId:', data.productId); return { ok: true, productId: data.productId }; }
                  } catch (e) { lastErr = { status: 0, tag, msg: e?.message || String(e) }; console.warn('[POLISOL] quote exception (' + tag + '):', lastErr); }
            }
            return { ok: false, error: lastErr };
      }

      // === CART SUMMARY (ecwid-like) ===
      function ensureSummaryStyles() {
            if (__cpc.cssInjected) return;
            const css = `
.ec-card.polisol-summary { margin: 16px 0 8px; border: 1px solid #e7e7e7; border-radius: 12px; overflow: hidden; background: #fff; }
.ec-card__header { padding: 12px 16px; font-weight: 600; background: #f8f8f8; }
.ec-card__body { padding: 8px 0 12px; }
.polisol-table { width: 100%; border-collapse: collapse; }
.polisol-table th, .polisol-table td { padding: 10px 12px; border-top: 1px solid #eee; text-align: left; vertical-align: middle; }
.polisol-table th:first-child, .polisol-table td:first-child { width: 44px; text-align: center; }
.polisol-td-right { text-align: right; white-space: nowrap; }
.polisol-row-total td { font-weight: 700; border-top: 2px solid #ddd; }
.polisol-empty { padding: 10px 16px; color: #777; }
.polisol-inline { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.polisol-inline-row { display:flex; gap:10px; flex-wrap: wrap; align-items: center; }
.polisol-hint { font-size: 14px; color: #555; }
.polisol-progress { height: 8px; background: #f0f2f5; border-radius: 999px; overflow: hidden; }
.polisol-progress__bar { height: 100%; background: #2c7be5; width: 0%; transition: width .25s ease; }

.ec-button { display:inline-flex; align-items:center; justify-content:center; padding:10px 14px; border-radius:8px; text-decoration:none; border:1px solid transparent; cursor:pointer; font-weight:600; }
.ec-button--primary { background:#2c7be5; color:#fff; }
.ec-button--primary:hover { filter:brightness(0.96); }
.ec-button--ghost { background:#fff; color:#2c7be5; border-color:#d6e4ff; }
.ec-button--ghost:hover { background:#f6f9ff; }
@media (max-width: 480px){ .polisol-inline-row { flex-direction: column; align-items: stretch; } .ec-button { width:100%; } }
    `.trim();
            const style = document.createElement('style'); style.id = 'polisol-cart-summary-style'; style.textContent = css; document.head.appendChild(style);
            __cpc.cssInjected = true;
      }
      function ensureSummaryContainer() {
            let host = document.getElementById('polisol-cart-summary'); if (host) return host;
            ensureSummaryStyles();
            host = document.createElement('div'); host.id = 'polisol-cart-summary'; host.className = 'ec-card polisol-summary';
            host.innerHTML = `<div class="ec-card__header">Підсумок кошика POLISOL</div><div class="ec-card__body" id="polisol-body">Кошик порожній для POLISOL.</div>`;
            const descr = document.querySelector('#productDescription.product-details__product-description') || document.getElementById('productDescription');
            if (descr && descr.parentNode) { descr.parentNode.insertBefore(host, descr); }
            else { const container = document.querySelector('.ec-product-details, .ecwid-productBrowser-details, .product-details') || document.body; container.insertBefore(host, container.firstChild); }
            return host;
      }
      function inferCanonFromName(name) { const n = String(name || ''); const m = n.match(/«([^»]+)»/); if (m && m[1]) return removeQuotes(m[1]); return canonContent(n) || ''; }
      function cartFingerprint(items, lock) {
            const fam = (items || []).filter(it => itemSku(it).indexOf(FAMILY_PREFIX) === 0);
            const li = (lock && lock.batchIndex) ? String(lock.batchIndex) : '0';
            const parts = ['L' + li];
            for (const it of fam) { parts.push(itemSku(it) + ':' + (it.quantity || 0) + ':' + (getUnitPrice(it) || 0)); }
            return parts.join('|');
      }
      function renderCartSummarySync(cart) {
            const host = ensureSummaryContainer();
            const body = host.querySelector('#polisol-body');
            const items = (cart && cart.items) || [];
            const fam = items.filter(it => itemSku(it).indexOf(FAMILY_PREFIX) === 0);
            const lock = getLock();
            const limit = lock ? batchLimitByIndex(lock.batchIndex) : null;

            const fp = cartFingerprint(items, lock);
            if (__cpc.summaryFP === fp) return;
            __cpc.summaryFP = fp;

            if (!fam.length) {
                  body.textContent = 'Кошик порожній для POLISOL.';
                  return;
            }

            let rows = '', total = 0;
            fam.forEach((it, i) => {
                  const idx = i + 1;
                  const canon = getItemContentLabel(it) || inferCanonFromName(it.name || '') || '—';
                  const label = `ПОЛІСОЛ™«${canon}»${limit ? ' (ціна в партії ' + limit + ')' : ''}`;
                  const qty = Number(it.quantity || 0);
                  const unit = getUnitPrice(it);
                  const sum = unit * qty; total += sum;
                  rows += `
        <tr>
          <td>${idx}</td>
          <td>${label}</td>
          <td class="polisol-td-right">${qty} банок</td>
          <td class="polisol-td-right">${formatUAH(unit)}</td>
          <td class="polisol-td-right">${formatUAH(sum)}</td>
        </tr>`;
            });

            body.innerHTML = `
      <table class="polisol-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Найменування</th>
            <th class="polisol-td-right">Кількість</th>
            <th class="polisol-td-right">Ціна</th>
            <th class="polisol-td-right">Сума</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="polisol-row-total">
            <td></td>
            <td>Сума разом</td>
            <td></td>
            <td></td>
            <td class="polisol-td-right">${formatUAH(total)}</td>
          </tr>
        </tfoot>
      </table>`;
      }
      async function renderCartSummary() {
            try {
                  const cart = await fetchCart();
                  renderCartSummarySync(cart);
            } catch (_) { /* noop */ }
      }

      // === INLINE PANEL after Add to Bag ===
      function ensureInlinePanel() {
            let panel = document.getElementById('polisol-inline');
            if (panel) return panel;

            const addBtn = document.querySelector('.details-product-purchase__add-to-bag button.form-control__button');
            if (!addBtn) return null;

            panel = document.createElement('div');
            panel.id = 'polisol-inline';
            panel.className = 'polisol-inline';
            panel.innerHTML = `
      <div class="polisol-inline-row">
        <a href="#!/cart" class="ec-button ec-button--ghost" id="polisol-edit-cart" aria-label="Редагувати кошик">Редагувати кошик</a>
        <div class="polisol-hint" id="polisol-hint" style="display:none"></div>
      </div>
      <div class="polisol-progress" id="polisol-progress" style="display:none"><div class="polisol-progress__bar" id="polisol-progress-bar"></div></div>
      <div class="polisol-inline-row" id="polisol-checkout-row" style="display:none">
        <a href="#!/checkout" class="ec-button ec-button--primary" id="polisol-checkout" aria-label="Оформити замовлення">Оформити замовлення</a>
      </div>
    `;
            addBtn.parentNode.insertBefore(panel, addBtn.nextSibling);
            return panel;
      }
      const inlineFingerprint = (limit, currentQty) => 'L' + (limit || 0) + '|Q' + (currentQty || 0);
      async function renderInlinePanel(optionalCart) {
            const panel = ensureInlinePanel(); if (!panel) return;
            const hint = panel.querySelector('#polisol-hint');
            const pbar = panel.querySelector('#polisol-progress');
            const bar = panel.querySelector('#polisol-progress-bar');
            const rowCh = panel.querySelector('#polisol-checkout-row');

            const cart = optionalCart || await fetchCart();
            const items = cart.items || [];
            const lock = getLock();
            const uiCount = readBatchCount(); const uiIdx = uiCount ? batchCountToIndex(uiCount) : null;

            const idx = (lock && lock.batchIndex) ? lock.batchIndex : (uiIdx || null);
            const limit = idx ? batchLimitByIndex(idx) : null;
            const currentQty = sumFamilyQty(items);
            const fp = inlineFingerprint(limit, currentQty);
            if (__cpc.inlineFP === fp) return;
            __cpc.inlineFP = fp;

            if (!limit) {
                  if (hint) { hint.style.display = 'none'; hint.textContent = ''; }
                  if (pbar) pbar.style.display = 'none';
                  if (rowCh) rowCh.style.display = 'none';
                  return;
            }

            const remaining = Math.max(0, limit - currentQty);
            const percent = Math.max(0, Math.min(100, Math.round((currentQty / limit) * 100)));

            if (hint) {
                  hint.style.display = '';
                  hint.textContent = `Залишилось ${remaining} з ${limit}`;
            }
            if (pbar && bar) {
                  pbar.style.display = '';
                  bar.style.width = percent + '%';
            }
            if (rowCh) {
                  rowCh.style.display = (percent >= 100) ? '' : 'none';
            }
      }

      // === Add to Cart interception ===
      function findQtyInput() {
            return document.querySelector('.details-product-purchase__qty input[type="number"]')
                  || document.querySelector('input[type="number"][name="quantity"]');
      }
      async function handleAddToBagClick(e) {
            const tgt = e.target; if (!(tgt instanceof Element)) return;
            const btn = tgt.closest('.details-product-purchase__add-to-bag button.form-control__button'); if (!btn) return;
            if (!isTargetProduct()) return;

            e.preventDefault(); e.stopPropagation();
            if (__cpc.adding) return; __cpc.adding = true;

            let lockSetThisClick = false;
            let added = false;

            try {
                  const { idx, canon } = refreshUnitPrice();
                  if (!idx) { alert('Оберіть розмір партії.'); return; }
                  if (!canon) { alert('Оберіть «Вміст».'); return; }

                  const contentKey = (() => {
                        switch (canon) {
                              case 'Класичний': return 'classic';
                              case 'Шипшина': return 'rosehip';
                              case 'Журавлина': return 'cranberry';
                              case "Матусине здоров'я": return 'matusyne';
                              case 'Чоловіча Сила': return 'cholovicha';
                              case 'Квас трипільський': return 'kvas';
                              case 'Квас трипільський (білий)': return 'kvas_bilyi';
                              case 'Квас трипільський з коріандром': return 'kvas_koriandr';
                              default: return null;
                        }
                  })();
                  if (!contentKey) { alert('Невідомий «Вміст» (contentKey).'); return; }

                  const qty = Math.max(1, parseInt((findQtyInput()?.value || '1'), 10) || 1);

                  const cart = await fetchCart();
                  const hasFam = cartHasFamily(cart.items);
                  let lock = getLock();

                  if (hasFam && !lock) { alert('У кошику вже є POLISOL з попередніх дій. Оформіть/очистьте його перед зміною партії.'); return; }
                  if (lock) {
                        if (String(lock.batchIndex) !== String(idx)) { const lim = batchLimitByIndex(lock.batchIndex); alert('У кошику зафіксована інша партія на ' + lim + ' шт. Очистьте кошик або оформіть замовлення.'); return; }
                  } else {
                        setLock({ batchIndex: idx }); lockSetThisClick = true; lock = getLock();
                  }

                  const limit = batchLimitByIndex(lock.batchIndex);
                  const currentQty = sumFamilyQty(cart.items);
                  const remaining = limit - currentQty;
                  if (remaining <= 0) { alert('Досягнуто ліміт партії (' + limit + ' шт.).'); return; }
                  if (qty > remaining) { alert('Можна додати не більше ' + remaining + ' шт. (ліміт ' + limit + ').'); return; }

                  const quo = await requestQuote({ canon, contentKey, idx });
                  if (!quo.ok) { const err = quo.error || {}; const status = (err.status != null ? 'HTTP ' + err.status + ' ' : ''); const detail = (typeof err.msg === 'string' ? err.msg : (err.msg == null ? '' : String(err.msg))); alert('Помилка серверу: ' + status + (detail || 'невідома помилка')); return; }

                  const result = await Promise.race([
                        new Promise((resolve) => { try { Ecwid.Cart.addProduct({ id: quo.productId, quantity: qty }, function () { resolve('cb'); }); } catch (_) { resolve('catch'); } }),
                        new Promise((resolve) => setTimeout(() => resolve('timeout'), 6000))
                  ]);
                  // даже при timeout добавление обычно произошло — считаем, что добавлено
                  added = (result === 'cb' || result === 'timeout' || result === 'catch');

                  await renderCartSummary();
                  await renderInlinePanel();
            } catch (err) {
                  // очищаем lock только если мы ставили его в этом клике и добавление точно НЕ произошло
                  if (lockSetThisClick && !added) clearLock();
                  alert('Помилка серверу: ' + (err?.message || err));
            } finally {
                  __cpc.adding = false;
            }
      }
      function attachAddToCart() {
            if (window.__cpc_add_bound) return;
            document.addEventListener('click', handleAddToBagClick, true);
            window.__cpc_add_bound = true;
      }

      // === Reactivity / observers ===
      function bindOptionChange() {
            if (__cpc.optsBound) return;
            document.addEventListener('change', (e) => { if (e.target && e.target.matches && e.target.matches('.form-control__select')) refreshUnitPrice(); }, true);
            document.addEventListener('change', (e) => { if (e.target && e.target.matches && e.target.matches('input.form-control__radio')) refreshUnitPrice(); }, true);
            __cpc.optsBound = true;
      }
      function observeDom() {
            const root = document.querySelector('.ec-product-details, .ecwid-productBrowser-details, .product-details') || document.querySelector('.ec-store, .ecwid-productBrowser') || document.body;
            if (__cpc.mo) { try { __cpc.mo.disconnect(); } catch (_) { } }
            const mo = new MutationObserver((mutations) => {
                  const pol = document.getElementById('polisol-cart-summary'); let onlyInside = true;
                  for (const m of mutations) { const t = m.target; if (!pol || !pol.contains(t)) { onlyInside = false; break; } }
                  if (onlyInside) return;
                  if (__cpc.moScheduled) return; __cpc.moScheduled = true;
                  requestAnimationFrame(() => {
                        __cpc.moScheduled = false;
                        refreshUnitPrice();
                        ensureInlinePanel();
                  });
            });
            mo.observe(root, { childList: true, subtree: true });
            __cpc.mo = mo;
      }
      function bindCartGuard() {
            if (__cpc.cartBound) return;
            Ecwid.OnCartChanged.add((cart) => {
                  const items = (cart && cart.items) || [];
                  if (!cartHasFamily(items)) clearLock();
                  try { renderCartSummarySync({ items }); } catch (_) { }
                  try { renderInlinePanel({ items }); } catch (_) { }
            });
            __cpc.cartBound = true;
      }

      // === Boot ===
      waitEcwid(async () => {
            Ecwid.OnAPILoaded.add(async () => {
                  await ensureVue();
                  Ecwid.OnPageLoaded.add(async (page) => {
                        if (page && page.type === 'PRODUCT') {
                              const sku = getSku(); if (sku) __cpc.currentSku = sku;
                              __cpc.isTargetMemo = (sku || '').indexOf(FAMILY_PREFIX) === 0;
                        } else { __cpc.currentSku = null; __cpc.isTargetMemo = null; }

                        if (page.type !== 'PRODUCT' || !isTargetProduct()) return;

                        try {
                              const res = await fetch(PRICING_ENDPOINT); const pr = await res.json();
                              if (!pr?.ok) throw new Error('pricing not ok');
                              const idxMap = {}; const entries = Object.entries(pr.pricing || {}); for (let i = 0; i < entries.length; i++) { idxMap[normalizeKey(entries[i][0])] = entries[i][1]; }
                              pricingCache = { ...pr, __index: idxMap };
                        } catch (e) { console.error('Failed to load pricing', e); pricingCache = null; }

                        bindOptionChange();
                        observeDom();
                        bindCartGuard();
                        attachAddToCart();

                        ensureSummaryContainer();
                        ensureInlinePanel();
                        await renderCartSummary();
                        await renderInlinePanel();
                        refreshUnitPrice();
                  });
            });
      });
})();
