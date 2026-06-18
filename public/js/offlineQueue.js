// =============================================================
// OfflineQueue — 오프라인 회의록 녹음 큐 (IndexedDB + 동기화)
//
// 흐름:
//   1) 사용자가 오프라인 상태에서 녹음 종료
//   2) MediaRecorder.onstop 핸들러에서 navigator.onLine 체크 → false 면
//      OfflineQueue.add(blob, meta) 로 IndexedDB 에 저장
//   3) UI 에 "대기 중 N건" 표시
//   4) 'online' 이벤트 발생 시 자동으로 OfflineQueue.process() 호출
//      - 각 pending/error 항목에 대해 /api/meeting/transcribe-async 업로드 + 폴링
//      - 결과는 IndexedDB 에 보관 → 사용자가 페이지에서 확인 + 회의록 저장 가능
//
// 저장 위치: IndexedDB 'oci_meeting_offline' / store 'recordings'
// 데이터 모델:
//   { id, blob, filename, mimetype, customer_name, meeting_date,
//     created_at, status, progress_msg, job_id, result, error }
//
// 상태 전이:
//   pending → uploading → transcribing → done
//                                       ↘ error (재시도 가능)
//
// 제약:
//   - 브라우저 IndexedDB 쿼터 (Safari iOS: ~50MB, Chrome: ~수 GB)
//   - 서버 재시작 시 진행 중인 job 손실 → 클라이언트 자동 재업로드 시도
// =============================================================
'use strict';

const OfflineQueue = {
  DB_NAME: 'oci_meeting_offline',
  STORE: 'recordings',
  VERSION: 1,
  _db: null,
  _processing: false,
  _listeners: new Set(), // UI 갱신 콜백

  // ── IndexedDB 핸들 ───────────────────────────────────────
  _open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          db.createObjectStore(this.STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => {
        this._db = req.result;
        resolve(this._db);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async _tx(mode) {
    const db = await this._open();
    return db.transaction(this.STORE, mode).objectStore(this.STORE);
  },

  // ── CRUD ─────────────────────────────────────────────────
  async add(blob, meta) {
    const store = await this._tx('readwrite');
    const item = {
      blob,
      filename: (meta && meta.filename) || `recording-${Date.now()}.webm`,
      mimetype: blob.type || 'audio/webm',
      customer_name: (meta && meta.customer_name) || '',
      meeting_date: (meta && meta.meeting_date) || '',
      meeting_title: (meta && meta.meeting_title) || '',
      created_at: Date.now(),
      status: 'pending', // pending | uploading | transcribing | done | error
      progress_msg: '',
      job_id: null,
      result: null, // { transcript, speakers, durationSec, sizeKB }
      error: null,
    };
    return new Promise((resolve, reject) => {
      const req = store.add(item);
      req.onsuccess = () => {
        item.id = req.result;
        this._notify();
        resolve(item);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async list() {
    const store = await this._tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async get(id) {
    const store = await this._tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async update(id, patch) {
    const store = await this._tx('readwrite');
    return new Promise((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) return reject(new Error('queue item not found: ' + id));
        Object.assign(item, patch);
        const putReq = store.put(item);
        putReq.onsuccess = () => {
          this._notify();
          resolve(item);
        };
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  },

  async remove(id) {
    const store = await this._tx('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => {
        this._notify();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async count() {
    const items = await this.list();
    return items.length;
  },

  // ── 리스너 (UI 갱신용) ──────────────────────────────────
  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },
  _notify() {
    this._listeners.forEach(fn => {
      try {
        fn();
      } catch (_) {}
    });
  },

  // ── 동기화 ───────────────────────────────────────────────
  async process() {
    if (this._processing) return { skipped: 'already running' };
    if (!navigator.onLine) return { skipped: 'offline' };
    this._processing = true;
    try {
      const items = await this.list();
      const pending = items.filter(i => i.status === 'pending' || i.status === 'error');
      for (const item of pending) {
        try {
          await this._processOne(item);
        } catch (err) {
          await this.update(item.id, {
            status: 'error',
            error: err.message || '처리 실패',
            progress_msg: '',
          });
        }
      }
      return { processed: pending.length };
    } finally {
      this._processing = false;
    }
  },

  async _processOne(item) {
    // 1) 업로드
    await this.update(item.id, {
      status: 'uploading',
      progress_msg: '📤 업로드 중...',
      error: null,
    });

    const fd = new FormData();
    fd.append('audio', item.blob, item.filename);
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    const uid = localStorage.getItem('current_user_id');
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (uid) headers['X-User-Id'] = uid;

    const uploadAborter = new AbortController();
    const uploadTimer = setTimeout(() => uploadAborter.abort(), 5 * 60 * 1000);
    let uploadRes;
    try {
      uploadRes = await fetch('/api/meeting/transcribe-async', {
        method: 'POST',
        body: fd,
        headers,
        signal: uploadAborter.signal,
      });
    } finally {
      clearTimeout(uploadTimer);
    }

    let uploadJson;
    try {
      uploadJson = await uploadRes.json();
    } catch (_) {
      throw new Error(`업로드 응답 해석 실패 (HTTP ${uploadRes.status})`);
    }
    if (!uploadJson.success || !uploadJson.job_id) {
      throw new Error(uploadJson.error || '업로드 실패');
    }

    // 2) 폴링
    await this.update(item.id, {
      status: 'transcribing',
      progress_msg: '🎙 음성 인식 중...',
      job_id: uploadJson.job_id,
    });

    const startedAt = Date.now();
    const MAX_POLL_MS = 30 * 60 * 1000;
    const POLL_MS = 5000;
    let consecErrors = 0;

    while (true) {
      if (Date.now() - startedAt > MAX_POLL_MS) {
        throw new Error('음성 인식 30분 초과 — 녹음을 분할해 주세요');
      }
      await new Promise(r => setTimeout(r, POLL_MS));
      let statRes;
      try {
        statRes = await fetch(
          '/api/meeting/transcribe-status/' + encodeURIComponent(uploadJson.job_id),
          { headers }
        );
      } catch (_) {
        if (++consecErrors >= 3) throw new Error('서버 상태 폴링 실패');
        continue;
      }
      let stat;
      try {
        stat = await statRes.json();
      } catch (_) {
        if (++consecErrors >= 3) throw new Error(`서버 응답 해석 실패 (HTTP ${statRes.status})`);
        continue;
      }
      consecErrors = 0;

      if (stat.status === 'done') {
        await this.update(item.id, {
          status: 'done',
          progress_msg: '',
          result: stat.data,
          error: null,
        });
        return;
      }
      if (stat.status === 'error' || stat.success === false) {
        throw new Error(stat.error || '음성 인식 실패');
      }
      const elapsed = stat.elapsed_sec || Math.round((Date.now() - startedAt) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      await this.update(item.id, {
        progress_msg: `🎙 음성 인식 중... (${mins}분 ${secs}초)`,
      });
    }
  },
};

if (typeof window !== 'undefined') {
  window.OfflineQueue = OfflineQueue;
  // 온라인 복귀 시 자동 처리
  window.addEventListener('online', () => {
    if (typeof Toast !== 'undefined') {
      OfflineQueue.count().then(n => {
        if (n > 0) Toast.info(`온라인 복귀 — 오프라인 녹음 ${n}건 처리 시작`);
      });
    }
    OfflineQueue.process();
  });
  // 부팅 시 1회 시도 (이전 세션에서 미처리 큐가 있으면)
  if (navigator.onLine) {
    // App 부팅 후 약간 지연 (auth 토큰 등 준비 시간)
    setTimeout(() => OfflineQueue.process(), 3000);
  }
}
