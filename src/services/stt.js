const fs = require('fs');
require('dotenv').config({ override: true });
const { genAI, MODEL_FAST, SAFETY_SETTINGS } = require('./gemini');

// 지원 오디오 MIME 타입 → Gemini inlineData mimeType 매핑
const MIME_MAP = {
  'audio/webm': 'audio/webm',
  'audio/ogg': 'audio/ogg',
  'audio/mpeg': 'audio/mp3',
  'audio/mp3': 'audio/mp3',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/flac': 'audio/flac',
  'audio/x-flac': 'audio/flac',
  'audio/mp4': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/aac': 'audio/aac',
};

// 큰 파일은 inline base64 가 아닌 Gemini Files API 로 업로드 후 URI 참조 사용.
// inline 한계 + 처리시간 단축. (20MB 가 안전한 경계 — 실제 API limit 보다 보수적)
const FILES_API_THRESHOLD = 10 * 1024 * 1024; // 10MB 이상이면 Files API

// Gemini 처리 자체 타임아웃 — 응답이 너무 오래 걸리면 명시적으로 끊고 친절한 에러 반환
const GEMINI_TIMEOUT_MS = 12 * 60 * 1000; // 12분

function timeout(ms, label) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timeout (${Math.round(ms / 1000)}초 초과)`)), ms);
  });
}

// Files API 로 업로드 후 ACTIVE 상태가 될 때까지 폴링
async function uploadToFilesApi(filePath, mime) {
  // SDK 의 GoogleAIFileManager 는 별도 서브 경로에서 export 됨
  const { GoogleAIFileManager, FileState } = require('@google/generative-ai/server');
  const apiKey = process.env.GEMINI_API_KEY;
  const manager = new GoogleAIFileManager(apiKey);

  const uploadRes = await manager.uploadFile(filePath, {
    mimeType: mime,
    displayName: 'meeting-audio',
  });
  let file = uploadRes.file;

  // PROCESSING → ACTIVE 까지 폴링 (보통 수 초)
  const startedAt = Date.now();
  while (file.state === FileState.PROCESSING) {
    if (Date.now() - startedAt > 60 * 1000) {
      throw new Error('Gemini 파일 업로드 처리 60초 초과');
    }
    await new Promise(r => setTimeout(r, 2000));
    file = await manager.getFile(file.name);
  }
  if (file.state !== FileState.ACTIVE) {
    throw new Error(`Gemini 파일 처리 실패 (state=${file.state})`);
  }
  return { uri: file.uri, name: file.name, manager };
}

const PROMPT = `이 오디오 파일을 한국어로 전사(transcription)해주세요.

요구사항:
1. 모든 발화 내용을 정확하게 전사
2. 서로 다른 화자를 구분 (화자1, 화자2, 화자3 등으로 표시)
3. 응답은 반드시 다음 JSON 형식으로만 반환:

{
  "transcript": "전체 전사 텍스트 (화자 구분 없이 연속된 텍스트)",
  "speakers": [
    { "speaker": 1, "text": "화자1의 발화 내용" },
    { "speaker": 2, "text": "화자2의 발화 내용" },
    { "speaker": 1, "text": "화자1의 다음 발화" }
  ]
}

JSON 외 다른 텍스트는 절대 포함하지 마세요.`;

/**
 * Gemini 멀티모달 오디오 → 텍스트 변환 + 화자 분리
 *  - 작은 파일(<10MB): inline base64
 *  - 큰 파일(>=10MB): Files API 업로드 후 URI 참조 (20분+ 녹음 안정성)
 */
async function transcribeAudio(filePath, mimetype, fileSize) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 미설정');

  const mime = MIME_MAP[(mimetype || '').toLowerCase()] || 'audio/webm';

  const model = genAI.getGenerativeModel({
    model: MODEL_FAST,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  // 파일 크기에 따라 입력 방식 결정
  let audioPart;
  let fileRef = null; // Files API 사용 시 마지막에 삭제하기 위한 핸들

  if (fileSize >= FILES_API_THRESHOLD) {
    fileRef = await uploadToFilesApi(filePath, mime);
    audioPart = { fileData: { mimeType: mime, fileUri: fileRef.uri } };
  } else {
    const audioData = await fs.promises.readFile(filePath);
    audioPart = { inlineData: { mimeType: mime, data: audioData.toString('base64') } };
  }

  let result;
  try {
    // generateContent 와 timeout race — 명시적 timeout 으로 nginx 504 보다 먼저 응답
    result = await Promise.race([
      model.generateContent([{ text: PROMPT }, audioPart]),
      timeout(GEMINI_TIMEOUT_MS, 'Gemini 전사'),
    ]);
  } finally {
    // Files API 업로드 파일은 사용 후 삭제 (할당량 보호)
    if (fileRef?.manager && fileRef?.name) {
      fileRef.manager.deleteFile(fileRef.name).catch(() => {});
    }
  }

  const raw = result.response.text().trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch (__) {
        /* fallback parse 도 실패 — raw 그대로 단일 화자 */
      }
    }
  }

  if (!parsed) {
    // JSON 파싱 실패 시 원본 텍스트를 단일 화자로 처리 (기존 동작 보존)
    return {
      transcript: raw,
      speakers: [{ speaker: 1, text: raw }],
      durationSec: Math.round((fileSize * 8) / (128 * 1000)),
      sizeKB: Math.round(fileSize / 1024),
    };
  }

  return {
    transcript: parsed.transcript || raw,
    speakers: Array.isArray(parsed.speakers)
      ? parsed.speakers
      : [{ speaker: 1, text: parsed.transcript || raw }],
    durationSec: Math.round((fileSize * 8) / (128 * 1000)),
    sizeKB: Math.round(fileSize / 1024),
  };
}

module.exports = { transcribeAudio };
