(function () {
      // === Endpoints (поместите в ваш Nuxt-проект вместе с остальными API) ===
      const API_BASE = 'https://ecwid-cust-cost-poli.vercel.app'; // тот же проект Nuxt
      const PRICING_ENDPOINT = API_BASE + '/api/polisol/pricing';
      const QUOTE_ENDPOINT = API_BASE + '/api/polisol/quote';

      // === Константы ===
      const LOCK_KEY = 'polisol_batch_lock'; // localStorage
      const FAMILY_PREFIX = 'ПОЛІСОЛ-';      // базовое семейство для таргета
      const RADIO_NAME = 'Вміст';
      const BATCH_ARIA = 'розмір партії (вплив на опт.ціни)';

      // === Утилиты ===
      function waitEcwid(cb) { (typeof Ecwid !== 'undefined' && Ecwid.OnAPILoaded) ? cb() : setTimeout(() => waitEcwid(cb), 100); }
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
      function isTargetProduct() {
            const sku = getSku() || '';
            return sku.startsWith(FAMILY_PREFIX);
      }
      function findBatchInput() {
            // Ecwid «dropdown» часто рендерит как readonly input + соседний .form-control__select-text
            const inp = document.querySelector(`input[aria-label="${BATCH_ARIA}"]`);
            return inp || null;
      }
      function readBatchCount() {
            const inp = findBatchInput();
            if (!inp) return null;
            const container = inp.closest('.form-control');
            const txt = container?.querySelector('.form-control__select-text')?.textContent?.trim() || inp.value || '';
            const m = txt.match(/\d+/);
            return m ? parseInt(m[0], 10) : null; // 15 / 30 / 45 / 60 / 75
      }
      function batchCountToIndex(n) {
            return (n === 15 ? 1 : n === 30 ? 2 : n === 45 ? 3 : n === 60 ? 4 : n === 75 ? 5 : null);
      }
      function indexToBatchCount(idx) {
            return ({ 1: 15, 2: 30, 3: 45, 4: 60, 5: 75 })[idx] || null;
      }
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
            // ₴ + пробел как разделитель тысяч, 2 знака
            const s = Number(n).toFixed(2);
            // простая группировка (без локали)
            const [i, d] = s.split('.');
            const withSpace = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
            return `₴${withSpace}.${d}`;
      }
      function getCheckedContent() {
            const list = Array.from(document.querySelectorAll(`input.form-control__radio[name="${RADIO_NAME}"]`));
            const checked = list.find(el => el.checked);
            if (!checked) return null;
            const label = document.querySelector(`label[for="${checked.id}"]`)?.textContent?.trim() || checked.value || '';
            return label.replace(/[«»"]/g, '').trim();
      }
      function suffixForContent(label) {
            // по вашей карте
            const t = label.toLowerCase();
            if (/класич/i.test(t) || /класіч/i.test(t)) return 'К';
            if (/чоловіч/i.test(t)) return 'Ч';
            if (/матусин/i.test(t)) return 'М';
            if (/шипшин/i.test(t)) return 'Ш';
            if (/журавлин/i.test(t)) return 'Ж';
            if (/білий/i.test(t)) return 'КБ';
            if (/коріандр/i.test(t)) return 'КК';
            return 'КВ'; // дефолт — «Квас трипільський»
      }
      function saveLock(state) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(state)); } catch { } }
      function loadLock() { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch { return null; } }
      function clearLock() { try { localStorage.removeItem(LOCK_KEY); } catch { } }

      // === Vue виджет ===
      function mountApp(pricing) {
            const { createApp, ref, computed, onMounted, watch } = Vue;

            // Впишемся в #productDescription мини-компонентом таблицы корзины
            let host = document.getElementById('cpc-polisol-summary');
            if (!host) {
                  host = document.createElement('div');
                  host.id = 'cpc-polisol-summary';
                  host.style.marginTop = '10px';
                  const desc = document.getElementById('productDescription');
                  if (desc) desc.appendChild(host);
            }

            const app = createApp({
                  setup() {
                        const originalPriceText = ref(null);
                        const locked = ref(false);
                        const batchIndex = ref(null); // 1..5
                        const unitPrice = ref(0);
                        const contentLabel = ref('');
                        const variantSuffix = ref('');
                        const cartItems = ref([]); // только наше семейство и текущая партия
                        const batchCount = computed(() => batchIndex.value ? indexToBatchCount(batchIndex.value) : null);

                        function updatePriceUI() {
                              const { span, box } = priceEls();
                              if (!span) return;
                              if (!originalPriceText.value) originalPriceText.value = span.textContent;
                              if (unitPrice.value) {
                                    span.textContent = formatUAH(unitPrice.value);
                                    if (box) box.setAttribute('content', String(unitPrice.value));
                              } else {
                                    // сбросим на оригинал
                                    if (originalPriceText.value) span.textContent = originalPriceText.value;
                              }
                        }

                        async function refreshUnitPrice() {
                              const bCount = readBatchCount();
                              const idx = bCount ? batchCountToIndex(bCount) : null;
                              batchIndex.value = idx;
                              const lbl = getCheckedContent();
                              contentLabel.value = lbl || '';
                              variantSuffix.value = lbl ? suffixForContent(lbl) : '';

                              if (idx && lbl) {
                                    // достанем цену из pricing.pricing[canon][idx-1]
                                    // На клиенте без канонизации — просто запросим у серверного POST при добавлении.
                                    // Но для UI удобно подставить локально.
                                    try {
                                          const canon = lbl.replace(/[«»"]/g, '').trim();
                                          const row = pricing.pricing[canon] || pricing.pricing['Квас трипільський'];
                                          unitPrice.value = row[idx - 1] || 0;
                                    } catch { unitPrice.value = 0; }
                              } else {
                                    unitPrice.value = 0;
                              }
                              updatePriceUI();
                        }

                        function ensureLockVisibility() {
                              const bCount = readBatchCount();
                              const lockBox = document.getElementById('cpc-batch-lock');
                              if (!lockBox) return;
                              if (bCount) {
                                    lockBox.style.display = 'flex';
                                    lockBox.querySelector('input').disabled = false;
                              } else {
                                    lockBox.style.display = 'none';
                                    lockBox.querySelector('input').disabled = true;
                              }
                        }

                        function renderLockCheckbox() {
                              if (document.getElementById('cpc-batch-lock')) return;
                              const target = findBatchInput()?.closest('.form-control');
                              if (!target) return;
                              const wrap = document.createElement('div');
                              wrap.id = 'cpc-batch-lock';
                              wrap.style.display = 'none';
                              wrap.style.marginTop = '8px';
                              wrap.style.alignItems = 'center';
                              wrap.style.gap = '8px';
                              wrap.innerHTML = `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" checked />
              <span>Блокування партії</span>
            </label>
          `;
                              target.appendChild(wrap);

                              const cb = wrap.querySelector('input');
                              cb.addEventListener('change', async () => {
                                    if (!cb.checked) {
                                          const ok = window.confirm('Розблокувати партію? Кошик буде очищено.');
                                          if (!ok) { cb.checked = true; return; }
                                          Ecwid.Cart.clear(() => {
                                                clearLock();
                                                locked.value = false;
                                                const sel = findBatchInput();
                                                if (sel) {
                                                      // разблокируем dropdown — для Ecwid select чаще всего надо кликнуть по control,
                                                      // но мы ограничимся снятием «заблокировано» визуально: пользователь сам сможет выбрать заново.
                                                      sel.closest('.form-control')?.classList.remove('cpc-disabled');
                                                }
                                                unitPrice.value = 0;
                                                updatePriceUI();
                                                renderCartTable([]); // очистим табличку
                                          });
                                    } else {
                                          // включили заново
                                          const idx = batchIndex.value;
                                          if (!idx) { cb.checked = false; return; }
                                          locked.value = true;
                                          saveLock({ locked: true, batchIndex: idx });
                                          // визуально «заблокируем» селект
                                          findBatchInput()?.closest('.form-control')?.classList.add('cpc-disabled');
                                    }
                              });
                        }

                        function applyLockFromState() {
                              const st = loadLock();
                              if (st && st.locked && st.batchIndex) {
                                    // восстановим блокировку
                                    locked.value = true;
                                    batchIndex.value = st.batchIndex;
                                    // выставим чекбокс и заблокируем дропдаун
                                    const cb = document.querySelector('#cpc-batch-lock input');
                                    if (cb) { cb.checked = true; }
                                    findBatchInput()?.closest('.form-control')?.classList.add('cpc-disabled');
                              }
                        }

                        function renderCartTable(items) {
                              cartItems.value = items;
                              // таблицу мы отображаем самим Vue-компонентом (ниже в template)
                        }

                        function sumForItems(items) {
                              return items.reduce((acc, it) => acc + (it.price * it.quantity), 0);
                        }

                        function skuMatchesOurBatch(sku, idx) {
                              if (!sku) return false;
                              return new RegExp(`^${FAMILY_PREFIX.replace('-', '\\-')}.+\\-${idx}$`).test(sku);
                        }

                        function fetchCartAndRender() {
                              Ecwid.Cart.get(function (cart) {
                                    const idx = batchIndex.value;
                                    if (!idx) { renderCartTable([]); return; }
                                    const ours = (cart.items || []).filter(it => skuMatchesOurBatch(it.sku, idx));
                                    renderCartTable(ours.map((it, i) => ({
                                          n: i + 1,
                                          name: it.name,
                                          quantity: it.quantity,
                                          price: it.price,        // за единицу
                                          sum: it.quantity * it.price,
                                    })));
                              });
                        }

                        function attachAddToCartInterceptor() {
                              if (window.__cpc_add_hooked) return;
                              const btn = findAddButton(); if (!btn) return;
                              document.addEventListener('click', async (e) => {
                                    const b = e.target.closest('.details-product-purchase__add-to-bag button.form-control__button');
                                    if (!b) return;
                                    if (!isTargetProduct()) return;

                                    e.preventDefault(); e.stopPropagation();

                                    const idx = batchIndex.value;
                                    if (!idx) { return alert('Оберіть партію спочатку.'); }
                                    const lbl = getCheckedContent();
                                    if (!lbl) { return alert('Оберіть «Вміст».'); }
                                    const suf = suffixForContent(lbl);
                                    const qtyInp = findQtyInput();
                                    const qty = Math.max(1, parseInt((qtyInp?.value || '1'), 10) || 1);

                                    if (!locked.value) {
                                          // автоматически включим блокировку при первом добавлении
                                          const cb = document.querySelector('#cpc-batch-lock input');
                                          if (cb) { cb.checked = true; }
                                          locked.value = true;
                                          saveLock({ locked: true, batchIndex: idx });
                                          findBatchInput()?.closest('.form-control')?.classList.add('cpc-disabled');
                                    }

                                    // проверим лимит суммарного количества в корзине для этой партии
                                    Ecwid.Cart.get(async function (cart) {
                                          const batchMax = indexToBatchCount(idx);
                                          const current = (cart.items || []).filter(it => skuMatchesOurBatch(it.sku, idx))
                                                .reduce((acc, it) => acc + it.quantity, 0);
                                          const remaining = batchMax - current;
                                          if (qty > remaining) {
                                                return alert(`Перевищено ліміт партії (${batchMax}). Доступно ще: ${remaining}.`);
                                          }

                                          // получим/создадим технический товар
                                          try {
                                                const payload = { contentLabel: lbl, variantSuffix: suf, batchIndex: idx };
                                                const r = await fetch(QUOTE_ENDPOINT, {
                                                      method: 'POST',
                                                      headers: { 'Content-Type': 'application/json' },
                                                      body: JSON.stringify(payload)
                                                });
                                                const data = await r.json();
                                                if (!r.ok || !data.ok) throw new Error(data?.error || r.statusText);

                                                Ecwid.Cart.addProduct({ id: data.productId, quantity: qty }, function () {
                                                      fetchCartAndRender();
                                                });
                                          } catch (err) {
                                                alert(`Помилка серверу: ${err?.message || err}`);
                                          }
                                    });
                              }, true);

                              window.__cpc_add_hooked = true;
                        }

                        // Обновление цены при изменении партии/вмісту
                        function observeOptionChanges() {
                              const root = document.querySelector('.ec-product-details, .ecwid-productBrowser-details, .product-details') ||
                                    document.querySelector('.ec-store, .ecwid-productBrowser') ||
                                    document.body;
                              const mo = new MutationObserver(() => {
                                    ensureLockVisibility();
                                    refreshUnitPrice();
                              });
                              mo.observe(root, { childList: true, subtree: true });
                        }

                        // при изменении корзины — обновим таблицу
                        onMounted(() => {
                              renderLockCheckbox();
                              ensureLockVisibility();
                              applyLockFromState();
                              refreshUnitPrice();
                              attachAddToCartInterceptor();
                              observeOptionChanges();

                              Ecwid.OnCartChanged.add(fetchCartAndRender);
                              fetchCartAndRender();
                        });

                        // Отрисовка таблицы (простая)
                        const total = computed(() => formatUAH(sumForItems(cartItems.value)));

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

      // === Bootstrap на нужной странице ===
      waitEcwid(() => {
            Ecwid.OnAPILoaded.add(() => {
                  Ecwid.OnPageLoaded.add(async page => {
                        if (page.type !== 'PRODUCT' || !isTargetProduct()) return;
                        // подгрузим прайс-матрицу
                        try {
                              const res = await fetch(PRICING_ENDPOINT);
                              const pricing = await res.json();
                              if (!pricing?.ok) throw new Error('pricing not ok');
                              mountApp(pricing);
                        } catch (e) {
                              console.error('Failed to load pricing', e);
                        }
                  });
            });
      });

})();
