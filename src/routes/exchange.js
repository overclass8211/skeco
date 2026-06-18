// =============================================================
// /api/exchange — 환율 조회 / 강제 갱신 / 수동 등록
// =============================================================
const router = require('express').Router();
const Fx = require('../services/exchange');
const { handleError } = require('../middleware/errorHandler');

// GET /api/exchange/rates — 현재 환율 표 (전 통화 최신)
router.get('/rates', async (req, res) => {
  try {
    const rows = await Fx.getAllLatest();
    res.json({ success: true, data: rows });
  } catch (e) {
    handleError(res, e);
  }
});

// GET /api/exchange/rate/:currency — 단일 환율
router.get('/rate/:currency', async (req, res) => {
  try {
    const rate = await Fx.getRate(req.params.currency);
    res.json({ success: true, currency: req.params.currency, rate });
  } catch (e) {
    handleError(res, e);
  }
});

// GET /api/exchange/convert?amount=&currency= — 환산 결과
router.get('/convert', async (req, res) => {
  try {
    const amount = parseFloat(req.query.amount);
    const currency = req.query.currency || 'KRW';
    if (!Number.isFinite(amount))
      return res.status(400).json({ success: false, error: 'amount 필요' });
    const krw = await Fx.convertToKrw(amount, currency);
    const rate = await Fx.getRate(currency);
    res.json({ success: true, amount, currency, krw, rate });
  } catch (e) {
    handleError(res, e);
  }
});

// POST /api/exchange/refresh — 강제 갱신 (관리자)
router.post('/refresh', async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin' && req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: '관리자 권한 필요' });
    }
    const result = await Fx.refreshAll();
    res.json({ success: true, ...result });
  } catch (e) {
    handleError(res, e);
  }
});

// POST /api/exchange/manual — 수동 환율 등록 (API 장애 대비)
router.post('/manual', async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'superadmin 권한 필요' });
    }
    const { rates } = req.body;
    if (!rates || typeof rates !== 'object') {
      return res.status(400).json({ success: false, error: 'rates 객체 필요' });
    }
    await Fx.saveRates(rates, 'manual');
    res.json({ success: true, saved: Object.keys(rates).length });
  } catch (e) {
    handleError(res, e);
  }
});

module.exports = router;
