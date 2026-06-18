// ============================================================
// Cost Management Page
// ============================================================
const CostPage = {
  activeTab: 'product',
  products: [],

  async render() {
    document.getElementById('content').innerHTML = `
      <div class="tab-bar">
        <button class="tab-btn ${this.activeTab === 'product' ? 'active' : ''}" data-tab="product">상품 원가</button>
        <button class="tab-btn ${this.activeTab === 'calculator' ? 'active' : ''}" data-tab="calculator">프로젝트 원가 산정</button>
        <button class="tab-btn ${this.activeTab === 'history' ? 'active' : ''}" data-tab="history">원가 변동 이력</button>
      </div>
      <div id="cost-content"><div class="loading">로딩중...</div></div>
    `;
    // tab delegation
    document.querySelector('.tab-bar')?.addEventListener('click', e => {
      const btn = e.target.closest('.tab-btn[data-tab]');
      if (btn) this.switchTab(btn.dataset.tab, btn);
    });

    await this.renderTab();
  },

  async switchTab(tab, btnEl) {
    this.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    else document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.classList.add('active');
    await this.renderTab();
  },

  async renderTab() {
    if (this.activeTab === 'product') return await this.renderProduct();
    if (this.activeTab === 'calculator') return this.renderCalculator();
    if (this.activeTab === 'history') return await this.renderHistory();
  },

  async renderProduct() {
    const result = await API.products.list();
    this.products = result.data;
    const today = new Date();
    const lastSync = today.toISOString().split('T')[0] + ' 06:00';

    const html = `
      <div class="flex-between mb-3">
        <div class="fs-12 text-muted">OnERP 연동 — 마지막 동기화: <strong>${lastSync}</strong></div>
        <div class="flex gap-2">
          <button class="btn btn-ghost" id="cost-sync-btn" data-feature="erp.integration">🔄 OnERP 동기화</button>
          <button class="btn btn-primary" id="cost-add-product-btn">+ 항목 추가</button>
        </div>
      </div>

      <div class="card">
        <div class="card-body no-pad">
          <table class="data-table">
            <thead>
              <tr>
                <th>품목명</th>
                <th>분류</th>
                <th>단위</th>
                <th class="text-right">현재 단가</th>
                <th class="text-right">전월 대비</th>
                <th>최종 갱신</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${this.products
                .map(
                  p => `
                <tr>
                  <td><strong>${esc(p.name)}</strong></td>
                  <td><span class="badge badge-gray">${esc(p.category || '-')}</span></td>
                  <td class="text-muted">${esc(p.unit || '-')}</td>
                  <td class="text-right mono"><strong>${this.formatPrice(p)}</strong></td>
                  <td class="text-right">${Fmt.changeIcon(p.change_pct)}</td>
                  <td class="text-muted fs-11">${Fmt.date(p.last_updated)}</td>
                  <td class="text-right">
                    <button class="btn btn-ghost btn-sm" data-action="edit-product" data-pid="${p.id}">수정</button>
                    <button class="btn btn-ghost btn-sm" data-action="delete-product" data-pid="${p.id}">삭제</button>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    document.getElementById('cost-content').innerHTML = html;

    document.getElementById('cost-sync-btn')?.addEventListener('click', () => this.syncOnERP());
    document
      .getElementById('cost-add-product-btn')
      ?.addEventListener('click', () => this.openProductForm());
    document.getElementById('cost-content').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const pid = parseInt(btn.dataset.pid);
      if (btn.dataset.action === 'edit-product') this.openProductForm(pid);
      else if (btn.dataset.action === 'delete-product') this.deleteProduct(pid);
    });
  },

  formatPrice(p) {
    const price = parseFloat(p.current_price);
    if (p.currency === 'KRW')
      return '₩' + price.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
    if (p.currency === 'USD') return '$' + price.toFixed(price < 1 ? 4 : 2);
    return p.currency + ' ' + price.toFixed(2);
  },

  syncOnERP() {
    Toast.success('OnERP 동기화가 시작되었습니다... (실제 환경에서 ERP API 호출)');
    setTimeout(() => Toast.success('동기화 완료'), 1500);
  },

  openProductForm(id = null) {
    const p = id ? this.products.find(x => x.id === id) : { current_price: '', currency: 'USD' };
    if (id && !p) return;
    Modal.open({
      title: id ? '원가 항목 수정' : '신규 원가 항목',
      body: `
        <div class="form-grid">
          <div class="form-field full">
            <label class="form-label required">품목명</label>
            <input class="form-control" id="cp-name" value="${esc(p.name || '')}" ${id ? 'readonly' : ''}>
          </div>
          <div class="form-field">
            <label class="form-label">분류</label>
            <select class="form-control" id="cp-category">
              <option ${p.category === '원자재' ? 'selected' : ''}>원자재</option>
              <option ${p.category === '모듈' ? 'selected' : ''}>모듈</option>
              <option ${p.category === '부품' ? 'selected' : ''}>부품</option>
              <option ${p.category === '인건비' ? 'selected' : ''}>인건비</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">단위</label>
            <input class="form-control" id="cp-unit" value="${esc(p.unit || '')}" placeholder="$/kg, $/장 등">
          </div>
          <div class="form-field">
            <label class="form-label required">현재 단가</label>
            <input class="form-control mono" id="cp-price" type="number" step="0.0001" value="${p.current_price || ''}">
          </div>
          <div class="form-field">
            <label class="form-label">통화</label>
            <select class="form-control" id="cp-currency">
              <option value="USD" ${p.currency === 'USD' ? 'selected' : ''}>USD</option>
              <option value="KRW" ${p.currency === 'KRW' ? 'selected' : ''}>KRW</option>
              <option value="EUR" ${p.currency === 'EUR' ? 'selected' : ''}>EUR</option>
              <option value="JPY" ${p.currency === 'JPY' ? 'selected' : ''}>JPY</option>
            </select>
          </div>
          <div class="form-field full">
            <label class="form-label">메모</label>
            <textarea class="form-control" id="cp-notes">${esc(p.notes || '')}</textarea>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="cost-product-cancel-btn">취소</button>
        <button class="btn btn-primary" id="cost-product-save-btn">저장</button>
      `,
      bind: {
        '#cost-product-cancel-btn': () => Modal.close(),
        '#cost-product-save-btn': () => this.saveProduct(id || null),
      },
    });
  },

  async saveProduct(id) {
    const body = {
      name: document.getElementById('cp-name').value.trim(),
      category: document.getElementById('cp-category').value,
      unit: document.getElementById('cp-unit').value,
      current_price: parseFloat(document.getElementById('cp-price').value),
      currency: document.getElementById('cp-currency').value,
      notes: document.getElementById('cp-notes').value,
    };
    if (!body.name || !body.current_price) return Toast.error('필수값을 입력해주세요');
    try {
      if (id) await API.products.update(id, body);
      else await API.products.create(body);
      Toast.success('저장되었습니다');
      Modal.close();
      this.renderProduct();
    } catch (_) {
      /* save error shown via Toast by API layer */
    }
  },

  deleteProduct(id) {
    Modal.confirm('이 원가 항목을 삭제하시겠습니까?', async () => {
      await API.products.delete(id);
      Toast.success('삭제되었습니다');
      this.renderProduct();
    });
  },

  renderCalculator() {
    document.getElementById('cost-content').innerHTML = `
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">원가 산정 계산기</div></div>
          <div class="card-body">
            <div class="form-grid">
              <div class="form-field full">
                <label class="form-label">프로젝트 규모 (MW)</label>
                <input class="form-control mono" id="calc-mw" type="number" value="30">
              </div>
              <div class="form-field">
                <label class="form-label">사업 유형</label>
                <select class="form-control" id="calc-type">
                  <option value="solar">태양광 EPC</option>
                  <option value="module">모듈 공급</option>
                  <option value="ess">ESS 공급</option>
                </select>
              </div>
              <div class="form-field">
                <label class="form-label">설치 형태</label>
                <select class="form-control" id="calc-install">
                  <option value="1">지상형</option>
                  <option value="1.15">지붕형 (+15%)</option>
                  <option value="1.25">수상형 (+25%)</option>
                  <option value="1.20">해외 현장 (+20%)</option>
                </select>
              </div>
            </div>
            <div class="card mt-3" style="background:var(--surface-2)">
              <div class="card-body">
                <div class="fs-11 text-muted mb-2">산정 결과</div>
                <div class="flex-between fs-12 mb-1"><span>모듈/장비 원가</span><span class="mono fw-bold" id="calc-equip">-</span></div>
                <div class="flex-between fs-12 mb-1"><span>설치/시공비</span><span class="mono fw-bold" id="calc-inst">-</span></div>
                <div class="flex-between fs-12 mb-2"><span>엔지니어링/기타</span><span class="mono fw-bold" id="calc-eng">-</span></div>
                <div style="border-top:1px solid var(--border);padding-top:8px" class="flex-between">
                  <strong>총 원가</strong>
                  <span class="mono" id="calc-total" style="color:var(--oci-red);font-weight:700;font-size:14px">-</span>
                </div>
                <div class="flex-between fs-12 text-muted mt-1">
                  <span>권장 판매가 (마진 20%)</span>
                  <span class="mono" id="calc-sale">-</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">참고 단가</div></div>
          <div class="card-body" id="calc-references"></div>
        </div>
      </div>
    `;
    // bind calculator inputs
    document.getElementById('calc-mw')?.addEventListener('input', () => this.calculate());
    document.getElementById('calc-type')?.addEventListener('change', () => this.calculate());
    document.getElementById('calc-install')?.addEventListener('change', () => this.calculate());

    this.renderReferences();
    this.calculate();
  },

  async renderReferences() {
    const result = await API.products.list();
    const html = result.data
      .slice(0, 7)
      .map(
        p => `
      <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
        <div>${esc(p.name)}</div>
        <div class="mono fw-bold">${this.formatPrice(p)}</div>
      </div>
    `
      )
      .join('');
    document.getElementById('calc-references').innerHTML = html;
  },

  calculate() {
    const mw = parseFloat(document.getElementById('calc-mw').value) || 0;
    const type = document.getElementById('calc-type').value;
    const mult = parseFloat(document.getElementById('calc-install').value);

    const baseRate = type === 'solar' ? 2.34 : type === 'module' ? 1.58 : 3.12;
    const total = mw * baseRate * mult;
    const equip = total * 0.65;
    const inst = total * 0.26;
    const eng = total * 0.09;

    document.getElementById('calc-equip').textContent = '₩' + equip.toFixed(2) + '억';
    document.getElementById('calc-inst').textContent = '₩' + inst.toFixed(2) + '억';
    document.getElementById('calc-eng').textContent = '₩' + eng.toFixed(2) + '억';
    document.getElementById('calc-total').textContent = '₩' + total.toFixed(2) + '억';
    document.getElementById('calc-sale').textContent = '₩' + (total * 1.2).toFixed(2) + '억';
  },

  async renderHistory() {
    const result = await API.products.list();
    const tracked = result.data.slice(0, 6);

    const histories = await Promise.all(
      tracked.map(p => API.products.history(p.id).then(r => ({ product: p, history: r.data })))
    );

    const validHistories = histories.filter(h => h.history.length > 0);

    document.getElementById('cost-content').innerHTML = `
      <div class="card">
        <div class="card-header"><div class="card-title">원가 변동 이력 (최근 90일)</div></div>
        <div class="card-body">
          <div class="chart-wrap" style="height:300px"><canvas id="cost-chart"></canvas></div>
        </div>
      </div>
    `;

    const ctx = document.getElementById('cost-chart');
    const colors = ['#E63329', '#1664E5', '#F59C00', '#7C4DFF', '#17A85A', '#E83535'];
    const datasets = validHistories.map((h, i) => ({
      label: h.product.name,
      data: h.history.map(x => ({ x: x.recorded_at, y: parseFloat(x.price) })),
      borderColor: colors[i % colors.length],
      tension: 0.3,
      pointRadius: 3,
      borderWidth: 2,
      fill: false,
    }));

    if (this.chart) this.chart.destroy();
    this.chart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: { xAxisKey: 'x', yAxisKey: 'y' },
        plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
        scales: {
          x: { type: 'category', grid: { display: false }, ticks: { font: { size: 11 } } },
          y: { grid: { color: '#E8EAED' }, ticks: { font: { size: 11 } } },
        },
      },
    });
  },
};
