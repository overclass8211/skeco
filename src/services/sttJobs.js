'use strict';
// =============================================================
// STT Jobs — 비동기 음성 인식 작업 큐 (긴 녹음 안정성 확보용)
//
// 배경:
//   120분급 녹음(~70MB)을 단일 HTTP 요청으로 처리하면 nginx 504 / 브라우저
//   탭 sleep / 네트워크 blip 등에서 깨짐. 업로드는 짧게 끝내고 백그라운드에서
//   처리하면서 클라이언트가 폴링하는 방식이 견고함.
//
// 흐름:
//   1) routes/meetings.js#POST /transcribe-async — multer 로 파일 저장 후
//      createJob() 호출 → job_id 즉시 반환 (202)
//   2) setImmediate 로 백그라운드에서 transcribeAudio() 실행 (기존 STT 그대로)
//   3) routes/meetings.js#GET /transcribe-status/:id — 상태 폴링 (1초 응답)
//
// 저장:
//   인메모리 Map (서버 재시작 시 손실 가능 — 트레이드오프 수용).
//   완료 작업은 4시간 후 자동 정리, 단일 작업 최대 25분 watchdog.
//
// 호환성:
//   기존 동기 라우트 /transcribe 와 동일한 transcribeAudio() 사용 →
//   결과 포맷 동일 ({ transcript, speakers, durationSec, sizeKB }).
// =============================================================

const fs = require('fs');
const crypto = require('crypto');
const { transcribeAudio } = require('./stt');

const jobs = new Map();
const TTL_MS = 4 * 60 * 60 * 1000; // 완료 작업 보관: 4시간
const MAX_PROCESSING_MS = 25 * 60 * 1000; // 단일 작업 최대 처리시간: 25분
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 청소 주기: 30분

function makeId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * 새 STT 작업 생성 + 백그라운드 처리 시작
 * @param {object} opts - { filePath, mimetype, fileSize, userId }
 * @returns {object} job - { id, status: 'pending', ... }
 */
function createJob({ filePath, mimetype, fileSize, userId }) {
  const job = {
    id: makeId(),
    status: 'pending', // pending → processing → done|error|cancelled
    fileSize: fileSize || 0,
    userId: userId || null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  };
  jobs.set(job.id, job);
  // 백그라운드 실행 (fire-and-forget). HTTP 응답을 차단하지 않음.
  setImmediate(() => runJob(job, filePath, mimetype, fileSize));
  return job;
}

async function runJob(job, filePath, mimetype, fileSize) {
  job.status = 'processing';
  job.startedAt = Date.now();

  // 단일 작업 watchdog — Gemini 무한 대기 방지
  const watchdog = setTimeout(() => {
    if (job.status === 'processing') {
      job.status = 'error';
      job.error = `STT 처리 ${Math.round(MAX_PROCESSING_MS / 60000)}분 초과`;
      job.finishedAt = Date.now();
    }
  }, MAX_PROCESSING_MS);

  try {
    const result = await transcribeAudio(filePath, mimetype, fileSize);
    // watchdog 가 먼저 발동한 경우 결과 무시 (이미 error 상태)
    if (job.status === 'processing') {
      job.status = 'done';
      job.result = result;
    }
  } catch (err) {
    if (job.status === 'processing') {
      job.status = 'error';
      job.error = err.message || '음성 인식 처리 중 오류';
    }
  } finally {
    job.finishedAt = job.finishedAt || Date.now();
    clearTimeout(watchdog);
    // 임시 업로드 파일은 항상 정리
    fs.unlink(filePath, () => {});
  }
}

/**
 * 작업 상태 조회
 */
function getJob(id) {
  return jobs.get(id) || null;
}

/**
 * (테스트 전용) 작업 큐 비우기
 */
function _resetForTest() {
  jobs.clear();
}

/**
 * (테스트 전용) 현재 작업 수
 */
function _size() {
  return jobs.size;
}

// 주기적 TTL 청소 — 메모리 누수 방지
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    const refTime = job.finishedAt || job.createdAt;
    if (now - refTime > TTL_MS) {
      jobs.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS);
// 테스트 환경에서 process 가 즉시 종료될 수 있도록 unref
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

module.exports = { createJob, getJob, _resetForTest, _size };
