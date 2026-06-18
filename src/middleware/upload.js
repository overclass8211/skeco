const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed =
      /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|mp3|wav|m4a|webm|ogg|opus|flac/;
    const ok =
      allowed.test(path.extname(file.originalname).toLowerCase()) ||
      (file.mimetype || '').startsWith('audio/');
    cb(null, ok);
  },
});

// 엑셀 가져오기용 메모리 스토리지 (디스크 저장 불필요)
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /xlsx|xls/.test(path.extname(file.originalname).toLowerCase());
    cb(null, ok);
  },
});

// 회의록 STT 전용 — 120분급 녹음(~80MB) 대응. 기존 25MB upload 와 분리해
// 일반 파일 첨부의 보안 한계는 유지.
const uploadAudio = multer({
  dest: uploadDir,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const ok =
      /\.(mp3|wav|m4a|webm|ogg|opus|flac)$/i.test(file.originalname) ||
      (file.mimetype || '').startsWith('audio/');
    cb(null, ok);
  },
});

// 로고 업로드 전용 — PNG/JPG/SVG 만 허용, 2MB 제한
// public/uploads/logos/ 디렉토리에 timestamp 포함 파일명으로 저장
const logoDir = path.join(uploadDir, 'logos');
if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });
const uploadLogo = multer({
  storage: multer.diskStorage({
    destination: logoDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `logo-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const ok =
      /\.(png|jpg|jpeg|svg)$/i.test(file.originalname) ||
      /^image\/(png|jpeg|svg\+xml)$/.test(file.mimetype || '');
    cb(null, ok);
  },
});

module.exports = upload;
module.exports.memory = uploadMemory;
module.exports.audio = uploadAudio;
module.exports.logo = uploadLogo;
