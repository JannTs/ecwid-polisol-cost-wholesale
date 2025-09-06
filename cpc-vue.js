/* POLISOL widget v2025-09-06-10 */
/* ecwid-polisol-cost-wholesale — CPC VUE WIDGET (safe for canvas) */
(() => {
      // === Endpoints ===
      const API_BASE = 'https://ecwid-polisol-cost-wholesale.vercel.app';
      const PRICING_ENDPOINT = API_BASE + '/api/polisol/pricing';
      const QUOTE_ENDPOINT = API_BASE + '/api/polisol/quote';

      // === Family/SKU ===
      const FAMILY_PREFIX = 'ПОЛІСОЛ-';

      // === Globals ===
      let pricingCache = null; // { ok, pricing:{}, __index:{} }
      let initialPriceText = null;
      const __cpc = (window.__cpc = window.__cpc || { optsBound: false, mo: null, moScheduled: false, warned: new Set() });

      // === Utils ===
      function waitEcwid(cb) {
            (typeof Ecwid !== 'undefined' && Ecwid.OnAPILoaded) ? cb() : setTimeout(() => waitEcwid(cb), 100);
      }
      async function ensureVue() {
            try {
                  if (typeof window.Vue === 'object' && window.Vue && window.Vue.createApp) return;
                  await new Promise((res) => {
                        const s = document.createElement('script');
                        s.src = 'https://unpkg.com/vue@3/dist/vue.global.prod.js';
                        s.onload = res;
                        s.onerror = () => res();
                        document.head.appendChild(s);
                  });
            } catch (_) { /* noop */ }
      }

      function formatUAH(n) {
            try { return '₴' + Number(n || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
            catch (_) { return '₴' + (Number(n || 0)).toFixed(2); }
      }

      function replaceAll(src, what, withWhat) { return String(src).split(what).join(withWhat); }
      function removeQuotes(s) { return replaceAll(replaceAll(replaceAll(String(s), '«', ''), '»', ''), '"', ''); }
      function normApos(s) {
            let r = String(s || '');
            r = replaceAll(r, '’', "'"); // U+2019
            r = replaceAll(r, 'ʼ', "'"); // U+02BC
            r = replaceAll(r, '′', "'"); // U+2032
            r = replaceAll(r, '´', "'"); // U+00B4
            return r;
      }
      function normalizeKey(s) { return removeQuotes(normApos(String(s))).trim().toLowerCase(); }

      function extractAllowedNumber(str, allowed) {
            const a = String(str || '');
            let curr = '';
            for (let i = 0; i < a.length; i++) {
                  const ch = a[i];
                  if (ch >= '0' && ch <= '9') { curr += ch; }
                  else if (curr.length) { const v = parseInt(curr, 10); if (allowed.indexOf(v) >= 0) return v; curr = ''; }
            }
            if (curr.length) { const v = parseInt(curr, 10); if (allowed.indexOf(v) >= 0) return v; }
            return null;
      }

      function canonContent(label) {
            const t = normalizeKey(label);
            if (!t) return null;
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

      function contentKeyForCanon(canon) {
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
      }

      function getSku() {
            const sels = [
                  '[itemprop="sku"]',
                  '.product-details__product-sku',
                  '[data-product-sku]',
                  '.product-details__sku',
                  '.details-product-code__value',
                  '.ec-store__product-sku',
                  '.ecwid-productBrowser-sku'
            ];
            for (const s of sels) {
                  const el = document.querySelector(s);
                  if (!el) continue;
                  const raw = (el.getAttribute('content') || el.textContent || '').trim();
                  if (!raw) continue;
                  const up = raw.toUpperCase();
                  const tokens = up.split(' ').filter(Boolean);
                  const filtered = tokens.filter(t => t !== 'SKU');
                  if (filtered.length) return filtered[filtered.length - 1];
            }
            return null;
      }
      function isTargetProduct() { const sku = getSku() || ''; return sku.indexOf(FAMILY_PREFIX) === 0; }

      function findBatchControl() {
            const selects = Array.from(document.querySelectorAll('.form-control__select'));
            for (const s of selects) {
                  const opts = Array.from(s.options || []).map(o => o.textContent || '').join(' ');
                  if (extractAllowedNumber(opts, [15, 30, 45, 60, 75]) != null) return s.closest('.form-control') || null;
            }
            const controls = Array.from(document.querySelectorAll('.form-control'));
            for (const fc of controls) {
                  const t = (fc.innerText || '').trim();
                  if (extractAllowedNumber(t, [15, 30, 45, 60, 75]) != null) return fc;
            }
            return null;
      }

      function readBatchCount() {
            const fc = findBatchControl();
            if (!fc) return null;
            const sel = fc.querySelector('.form-control__select');
            if (sel && sel.value && ['Виберіть', 'Выберите', 'Select'].every(x => sel.value.indexOf(x) < 0)) {
                  const v = extractAllowedNumber(sel.value, [15, 30, 45, 60, 75]);
                  return v != null ? v : null;
            }
            const txt = (fc.querySelector('.form-control__select-text')?.textContent || fc.textContent || '').trim();
            const vv = extractAllowedNumber(txt, [15, 30, 45, 60, 75]);
            return vv != null ? vv : null;
      }

      function batchCountToIndex(n) { return (n === 15 ? 1 : n === 30 ? 2 : n === 45 ? 3 : n === 60 ? 4 : n === 75 ? 5 : null); }

      function getCheckedContent() {
            const radios = Array.from(document.querySelectorAll('input.form-control__radio'));
            const r = radios.find(x => x.checked);
            if (!r) return null;
            const lbl = (document.querySelector('label[for="' + r.id + '"]')?.textContent || r.value || '').trim();
            return removeQuotes(lbl).trim();
      }

      function priceEls() {
            const span = document.querySelector('.details-product-price__value.ec-price-item');
            const box = document.querySelector('.product-details__product-price.ec-price-item[itemprop="price"]')
                  || document.querySelector('.product-details__product-price.ec-price-item');
            return { span, box };
      }
      function setPriceUI(numOrNull) {
            const { span, box } = priceEls();
            if (!span) return;
            if (initialPriceText == null) initialPriceText = span.textContent;
            if (typeof numOrNull === 'number' && Number.isFinite(numOrNull) && numOrNull > 0) {
                  span.textContent = formatUAH(numOrNull);
                  if (box) box.setAttribute('content', String(numOrNull));
            } else {
                  span.textContent = initialPriceText || '€0';
                  if (box) box.setAttribute('content', '0');
            }
      }

      function refreshUnitPrice() {
            if (!pricingCache || !pricingCache.ok) { setPriceUI(null); return { idx: null, canon: null, price: null }; }
            const bCount = readBatchCount();
            const idx = bCount ? batchCountToIndex(bCount) : null;
            const rawLabel = getCheckedContent();
            const canon = rawLabel ? canonContent(rawLabel) : null;
            if (idx && canon) {
                  const key = normalizeKey(canon);
                  const row = (pricingCache.__index && pricingCache.__index[key]) || null;
                  if (!row) {
                        if (!__cpc.warned.has(key)) {
                              console.warn('[POLISOL] price row not found for', canon, 'key=', key, 'available=', Object.keys(pricingCache.__index || {}));
                              __cpc.warned.add(key);
                        }
                        setPriceUI(null);
                        return { idx, canon, price: null };
                  }
                  const price = row[(idx - 1) | 0] || 0;
                  setPriceUI(price);
                  return { idx, canon, price };
            } else {
                  setPriceUI(null);
                  return { idx: idx || null, canon: canon || null, price: null };
            }
      }

      function findQtyInput() { return document.querySelector('.details-product-purchase__qty input[type="number"]') || document.querySelector('input[type="number"][name="quantity"]'); }

      function attachAddToCart() {
            if (window.__cpc_add_bound) return;
            document.addEventListener('click', async (e) => {
                  const tgt = e.target;
                  if (!(tgt instanceof Element)) return;
                  const btn = tgt.closest('.details-product-purchase__add-to-bag button.form-control__button');
                  if (!btn) return;
                  if (!isTargetProduct()) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const { idx, canon } = refreshUnitPrice();
                  if (!idx) return alert('Оберіть розмір партії.');
                  if (!canon) return alert('Оберіть «Вміст».');
                  const contentKey = contentKeyForCanon(canon);
                  if (!contentKey) return alert('Невідомий «Вміст» (contentKey).');
                  const qty = Math.max(1, parseInt((findQtyInput()?.value || '1'), 10) || 1);
                  try {
                        const r = await fetch(QUOTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentKey, batchIndex: idx }) });
                        const data = await r.json();
                        if (!r.ok || !data.ok) throw new Error(data?.error || r.statusText);
                        Ecwid.Cart.addProduct({ id: data.productId, quantity: qty }, function () { });
                  } catch (err) { alert('Помилка серверу: ' + (err?.message || err)); }
            }, true);
            window.__cpc_add_bound = true;
      }

      function bindOptionChange() {
            if (__cpc.optsBound) return;
            document.addEventListener('change', (e) => { if (e.target && e.target.matches && e.target.matches('.form-control__select')) refreshUnitPrice(); }, true);
            document.addEventListener('change', (e) => { if (e.target && e.target.matches && e.target.matches('input.form-control__radio')) refreshUnitPrice(); }, true);
            __cpc.optsBound = true;
      }

      function observeDom() {
            const root = document.querySelector('.ec-product-details, .ecwid-productBrowser-details, .product-details') || document.querySelector('.ec-store, .ecwid-productBrowser') || document.body;
            if (__cpc.mo) { try { __cpc.mo.disconnect(); } catch (_) { } }
            const mo = new MutationObserver(() => {
                  if (__cpc.moScheduled) return;
                  __cpc.moScheduled = true;
                  requestAnimationFrame(() => { __cpc.moScheduled = false; refreshUnitPrice(); });
            });
            mo.observe(root, { childList: true, subtree: true });
            __cpc.mo = mo;
      }

      // === Boot ===
      waitEcwid(async () => {
            Ecwid.OnAPILoaded.add(async () => {
                  await ensureVue();
                  Ecwid.OnPageLoaded.add(async (page) => {
                        if (page.type !== 'PRODUCT' || !isTargetProduct()) return;
                        try {
                              const res = await fetch(PRICING_ENDPOINT);
                              const pr = await res.json();
                              if (!pr?.ok) throw new Error('pricing not ok');
                              const idxMap = {};
                              const entries = Object.entries(pr.pricing || {});
                              for (let i = 0; i < entries.length; i++) { idxMap[normalizeKey(entries[i][0])] = entries[i][1]; }
                              pricingCache = { ...pr, __index: idxMap };
                        } catch (e) { console.error('Failed to load pricing', e); pricingCache = null; }
                        bindOptionChange();
                        observeDom();
                        attachAddToCart();
                        refreshUnitPrice();
                  });
            });
      });
})();
