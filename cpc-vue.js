(() => {
      // === Endpoints ===
      const API_BASE = 'https://ecwid-polisol-cost-wholesale.vercel.app';
      const PRICING_ENDPOINT = API_BASE + '/api/polisol/pricing';
      const QUOTE_ENDPOINT = API_BASE + '/api/polisol/quote';

      // === Константы ===
      const FAMILY_PREFIX = 'ПОЛІСОЛ-';         // таргет по SKU
      const RADIO_NAME_HINT = 'Вміст';          // имя группы радиокнопок (может отличаться, ищем эвристикой)

      // === Ecwid boot ===
      function waitEcwid(cb) { (typeof Ecwid !== 'undefined' && Ecwid.OnAPILoaded) ? cb() : setTimeout(() => waitEcwid(cb), 100); }

      // === Vue boot (если нет — догружаем CDN) ===
      async function ensureVue() {
            if (window.Vue && Vue.createApp) return;
            await new Promise((resolve, reject) => {
                  const s = document.createElement('script');
                  s.src = 'https://unpkg.com/vue@3.4.38/dist/vue.global.prod.js';
                  s.onload = resolve; s.onerror = reject;
                  document.head.appendChild(s);
            });
      }

      // === Утилиты DOM/цены ===
      function getSku() {
            const sels = [
                  '[itemprop="sku"]', '.product-details__product-sku', '[data-product-sku]',
                  '.product-details__sku', '.details-product-code__value', '.ec-store__product-sku', '.ecwid-productBrowser-sku'
            ];
            for (const s of sels) {
                  const el = document.querySelector(s);
                  if (!el) continue;
                  const raw = (el.getAttribute('content') || el.textContent || '').trim();
                  if (!raw) continue;
                  const tokens = raw.toUpperCase().match(/[A-ZА-ЯІЇЄҐ0-9._-]+/g) || [];
                  const filtered = tokens.filter(t => t !== 'SKU');
                  if (filtered.length) return filtered[filtered.length - 1];
            }
            return null;
      }
      function isTargetProduct() { const sku = getSku() || ''; return sku.startsWith(FAMILY_PREFIX); }

      // Поиск контейнера дропдауна «партії»
      function findBatchControl() {
            // сначала по aria-label (частые варианты)
            const cands = ['розмір партії (вплив на опт.ціни)', 'розмір партії', 'размер партии', 'партія', 'партия'];
            for (const label of cands) {
                  const el = document.querySelector(`input[aria-label="${label}"]`);
                  if (el) return el.closest('.form-control') || null;
            }
            // эвристика: любой .form-control, внутри текст с 15/30/45/60/75
            const ctrls = Array.from(document.querySelectorAll('.form-control'));
            for (const fc of ctrls) {
                  const t = (fc.querySelector('.form-control__select-text')?.textContent || fc.innerText || '').trim();
                  if (/\b(15|30|45|60|75)\b/.test(t)) return fc;
            }
            return null;
      }
      function readBatchCount() {
            const fc = findBatchControl(); if (!fc) return null;
            // 1) из <select>
            const sel = fc.querySelector('select[aria-label], select.form-control__select');
            let txt = '';
            if (sel && sel.selectedIndex >= 0) {
                  const opt = sel.options[sel.selectedIndex];
                  txt = (opt?.label || opt?.text || opt?.value || '').trim();
            }
            // 2) текстовый дублёр Ecwid
            if (!txt) txt = fc.querySelector('.form-control__select-text')?.textContent?.trim() || '';
            // 3) последний шанс — весь текст
            if (!txt) txt = (fc.innerText || '').trim();
            const m = txt.match(/\b(15|30|45|60|75)\b/);
            return m ? parseInt(m[1], 10) : null;
      }
      function batchCountToIndex(n) { return (n === 15 ? 1 : n === 30 ? 2 : n === 45 ? 3 : n === 60 ? 4 : n === 75 ? 5 : null); }
      function indexToBatchCount(idx) { return ({ 1: 15, 2: 30, 3: 45, 4: 60, 5: 75 })[idx] || null; }

      function findQtyInput() {
            return document.querySelector('.details-product-purchase__qty input[type="number"]') ||
                  document.querySelector('input[type="number"][name="quantity"]');
      }
      function findAddButton() {
            return document.querySelector('.details-product-purchase__add-to-bag button.form-control__button');
      }
      function priceEls() {
            const span = document.querySelector('.details-product-price__value.ec-price-item');
            const box = document.querySelector('.product-details__product-price.ec-price-item[itemprop="price"]') ||
                  document.querySelector('.product-details__product-price.ec-price-item');
            return { span, box };
      }
      function formatUAH(n) {
            const s = Number(n).toFixed(2);
            const [i, d] = s.split('.');
            const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F'); // узкий неразрывный пробел
            return `₴${grouped}.${d}`;
      }

      // Радиокнопки «Вміст»
      function getCheckedContent() {
            // пробуем максимально общий селектор
            let radios = Array.from(document.querySelectorAll('input[type="radio"].form-control__radio'));
            // сузим по name, если возможно
            const byName = radios.filter(r => /вміст/i.test(r.getAttribute('name') || ''));
            if (byName.length) radios = byName;
            // если всё равно пусто — план Б: строгое имя
            if (!radios.length) radios = Array.from(document.querySelectorAll(`input.form-control__radio[name="${RADIO_NAME_HINT}"]`));
            const checked = radios.find(r => r.checked);
            if (!checked) return null;
            const label = document.querySelector(`label[for="${checked.id}"]`)?.textContent?.trim() || checked.value || '';
            return label.replace(/[«»"]/g, '').replace(/\s+/g, ' ').trim();
      }

      // Нормализация к канону для таблицы цен
      function canonLabel(lblRaw) {
            const t = (lblRaw || '').toLowerCase();
            if (/класич/i.test(t) || /класіч/i.test(t)) return 'Класичний';
            if (/чоловіч/i.test(t)) return 'Чоловіча Сила';
            if (/матусин|матусине/i.test(t)) return "Матусине здоров'я";
            if (/шипшин/i.test(t)) return 'Шипшина';
            if (/журавлин/i.test(t)) return 'Журавлина';
            if (/білий|біле/i.test(t)) return 'Квас трипільський (білий)';
            if (/коріандр/i.test(t)) return 'Квас трипільський з коріандром';
            if (/квас/i.test(t)) return 'Квас трипільський';
            return null;
      }

      // SKU → batchIndex из корзины
      function extractBatchIdxFromSku(sku) {
            const m = String(sku || '').match(/ПОЛІСОЛ-[A-ZА-ЯІЇЄҐ]+-(\d)$/i);
            return m ? parseInt(m[1], 10) : null;
      }
      function getCartBatchIdx(cart) {
            const idxs = (cart.items || []).map(it => extractBatchIdxFromSku(it.sku)).filter(v => v != null);
            return idxs.length ? idxs[0] : null; // считаем корзину однородной по партии
      }

      // === Vue виджет ===
      function mountApp(pricing) {
            const { createApp, ref, computed, onMounted } = Vue;

            // Место для таблички набора
            let host = document.getElementById('cpc-polisol-summary');
            if (!host) {
                  host = document.createElement('div');
                  host.id = 'cpc-polisol-summary';
                  host.style.marginTop = '10px';
                  document.getElementById('productDescription')?.appendChild(host);
            }

            const app = createApp({
                  setup() {
                        const originalPriceText = ref(null);
                        const unitPrice = ref(0);
                        const cartItems = ref([]);
                        const batchIndex = ref(null);

                        function updatePriceUI() {
                              const { span, box } = priceEls();
                              if (!span) return;
                              if (!originalPriceText.value) originalPriceText.value = span.textContent;
                              if (unitPrice.value) {
                                    span.textContent = formatUAH(unitPrice.value);
                                    if (box) box.setAttribute('content', String(unitPrice.value));
                              } else {
                                    if (originalPriceText.value) span.textContent = originalPriceText.value;
                              }
                        }

                        function refreshUnitPrice() {
                              const bCount = readBatchCount();
                              const idx = bCount ? batchCountToIndex(bCount) : null;
                              batchIndex.value = idx;
                              const lbl = getCheckedContent();
                              const canon = lbl ? canonLabel(lbl) : null;

                              if (idx && canon && pricing?.pricing?.[canon]) {
                                    const priceRow = pricing.pricing[canon];
                                    unitPrice.value = priceRow[idx - 1] || 0;
                              } else {
                                    unitPrice.value = 0;
                              }
                              updatePriceUI();
                        }

                        function fetchCartAndRender() {
                              Ecwid.Cart.get(function (cart) {
                                    const idx = batchIndex.value;
                                    if (!idx) { cartItems.value = []; return; }
                                    const ours = (cart.items || []).filter(it => extractBatchIdxFromSku(it.sku) === idx);
                                    cartItems.value = ours.map((it, i) => ({
                                          n: i + 1,
                                          name: it.name,
                                          quantity: it.quantity,
                                          price: it.price,
                                          sum: it.quantity * it.price
                                    }));
                              });
                        }

                        function sumForItems(items) { return items.reduce((a, it) => a + it.sum, 0); }
                        const total = computed(() => formatUAH(sumForItems(cartItems.value)));

                        function attachAddToCartInterceptor() {
                              if (window.__cpc_add_hooked) return;
                              const btn = findAddButton(); if (!btn) return;

                              document.addEventListener('click', (e) => {
                                    const b = e.target.closest('.details-product-purchase__add-to-bag button.form-control__button');
                                    if (!b) return;
                                    if (!isTargetProduct()) return;

                                    e.preventDefault(); e.stopPropagation();

                                    const bCount = readBatchCount();
                                    const idx = bCount ? batchCountToIndex(bCount) : null;
                                    if (!idx) return alert('Оберіть партію спочатку.');

                                    const lbl = getCheckedContent();
                                    if (!lbl) return alert('Оберіть «Вміст».');

                                    const qtyInp = findQtyInput();
                                    const qty = Math.max(1, parseInt((qtyInp?.value || '1'), 10) || 1);

                                    Ecwid.Cart.get(function (cart) {
                                          const existingIdx = getCartBatchIdx(cart);
                                          if (existingIdx && existingIdx !== idx) {
                                                const ok = window.confirm(
                                                      `У кошику вже є товари з іншої партії (${indexToBatchCount(existingIdx)}).\n` +
                                                      `Очистити кошик і додати для партії ${indexToBatchCount(idx)}?`
                                                );
                                                if (!ok) return;
                                                return Ecwid.Cart.clear(() => actuallyAdd(lbl, idx, qty));
                                          }
                                          actuallyAdd(lbl, idx, qty);
                                    });
                              }, true);

                              window.__cpc_add_hooked = true;
                        }

                        async function actuallyAdd(lbl, idx, qty) {
                              try {
                                    const r = await fetch(QUOTE_ENDPOINT, {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ contentLabel: lbl, batchIndex: idx })
                                    });
                                    const data = await r.json().catch(() => ({}));
                                    if (!r.ok || !data.ok) {
                                          const msg = data?.message || data?.error || r.statusText || 'Unknown server error';
                                          throw new Error(msg);
                                    }
                                    Ecwid.Cart.addProduct({ id: data.productId, quantity: qty }, function () {
                                          fetchCartAndRender();
                                    });
                              } catch (err) {
                                    alert(`Помилка серверу: ${err?.message || err}`);
                              }
                        }

                        function observeOptionChanges() {
                              const root =
                                    document.querySelector('.ec-product-details, .ecwid-productBrowser-details, .product-details') ||
                                    document.querySelector('.ec-store, .ecwid-productBrowser') ||
                                    document.body;
                              const mo = new MutationObserver(() => {
                                    refreshUnitPrice();
                              });
                              mo.observe(root, { childList: true, subtree: true });
                        }

                        onMounted(() => {
                              refreshUnitPrice();
                              fetchCartAndRender();
                              Ecwid.OnCartChanged.add(fetchCartAndRender);
                              observeOptionChanges();
                              attachAddToCartInterceptor();
                        });

                        return { cartItems, total, formatUAH };
                  },
                  template: `
        <div v-if="cartItems.length" style="margin-top:8px;border-top:1px solid rgba(0,0,0,.08);padding-top:8px">
          <div style="font-weight:600;margin-bottom:6px">Ваш набір (для обраної партії)</div>
          <div style="overflow:auto">
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <thead>
                <tr>
                  <th style="text-align:left;padding:4px 6px">№</th>
                  <th style="text-align:left;padding:4px 6px">Товар</th>
                  <th style="text-align:right;padding:4px 6px">К-сть</th>
                  <th style="text-align:right;padding:4px 6px">Ціна</th>
                  <th style="text-align:right;padding:4px 6px">Сума</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="it in cartItems" :key="it.n">
                  <td style="padding:4px 6px">{{ it.n }}</td>
                  <td style="padding:4px 6px">{{ it.name }}</td>
                  <td style="padding:4px 6px;text-align:right">{{ it.quantity }}</td>
                  <td style="padding:4px 6px;text-align:right">{{ formatUAH(it.price) }}</td>
                  <td style="padding:4px 6px;text-align:right">{{ formatUAH(it.sum) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="4" style="padding:6px 6px;text-align:right;font-weight:600">Разом</td>
                  <td style="padding:6px 6px;text-align:right;font-weight:600">{{ total }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      `
            });

            app.mount('#cpc-polisol-summary');
      }

      // === Bootstrap: на продукте нашей семьи ===
      waitEcwid(() => {
            Ecwid.OnAPILoaded.add(() => {
                  Ecwid.OnPageLoaded.add(async (page) => {
                        if (page.type !== 'PRODUCT' || !isTargetProduct()) return;
                        try {
                              await ensureVue();
                              const res = await fetch(PRICING_ENDPOINT);
                              const pricing = await res.json();
                              if (!pricing?.ok) throw new Error('pricing not ok');
                              mountApp(pricing);
                        } catch (e) {
                              console.error('POLISOL init failed', e);
                        }
                  });
            });
      });
})();

