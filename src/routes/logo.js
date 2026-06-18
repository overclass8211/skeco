'use strict';
// =============================================================
// /api/system/logo — 로고 관리 (조회 + 업로드 + 복원)
//
// 🎯 목적:
//   고객사별로 시스템 좌측 상단 로고를 커스터마이징.
//   기본은 /assets/default-logo.svg, 업로드 시 /uploads/logos/* 사용.
//
// 권한:
//   GET  /api/system/logo            — 누구나 (로그인 페이지에서도 사용)
//   POST /api/admin/logo/upload      — admin(레벨 4) 이상
//   DELETE /api/admin/logo           — admin(레벨 4) 이상 (기본 복원)
//
// 저장 방식:
//   - 파일: public/uploads/logos/logo-{timestamp}.{ext}
//   - 경로: system_settings.logo_path 키-값으로 저장
//   - 기본값: NULL → 프론트엔드가 /assets/default-logo.svg 사용
//
// 캐시 회피:
//   파일명에 timestamp 포함 → 브라우저 캐시 자동 무효화
// =============================================================

const router = require('express').Router();
const pool = require('../db');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { optimize: svgOptimize } = require('svgo');
const { handleError } = require('../middleware/errorHandler');
const upload = require('../middleware/upload');
const logoCache = require('../utils/logoCache');

const DEFAULT_LOGO_URL = '/assets/default-logo.svg';

// ─── Magic Bytes 검증 (Polyglot 파일 방어) ───────────────────
// 파일 헤더의 실제 시그니처를 확인하여 확장자 위장 차단
const MAGIC_BYTES = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
  jpeg: [0xff, 0xd8, 0xff], // JPEG
  // SVG 는 텍스트 (XML) — 첫 줄에 '<?xml' 또는 '<svg' 확인
};
function validateMagicBytes(filePath, ext) {
  const buf = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }

  if (ext === '.png') {
    return MAGIC_BYTES.png.every((b, i) => buf[i] === b);
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return MAGIC_BYTES.jpeg.every((b, i) => buf[i] === b);
  }
  if (ext === '.svg') {
    const head = buf.toString('utf8').trim().toLowerCase();
    return head.startsWith('<?xml') || head.startsWith('<svg');
  }
  return false;
}

// ─── 이미지 최적화 (Sharp + svgo) ─────────────────────────────
// 목표:
//   - 가로 480px 이하 (Retina 2x 대응, 실제 표시 240px)
//   - PNG/JPG: sharp 로 리사이즈 + 압축
//   - SVG: svgo 로 sanitize (script 태그 + 이벤트 핸들러 제거) + 압축
// 반환: { originalSize, optimizedSize, savingsPercent, width, height }
async function optimizeImage(filePath, ext) {
  const originalSize = fs.statSync(filePath).size;

  if (ext === '.svg') {
    // SVG: svgo 로 sanitize + 최적화
    const svgContent = fs.readFileSync(filePath, 'utf8');
    const result = svgOptimize(svgContent, {
      multipass: true,
      plugins: [
        'preset-default',
        // XSS 차단 — script/이벤트 핸들러 제거
        { name: 'removeScriptElement' },
        {
          name: 'removeAttrs',
          params: { attrs: 'on.*' }, // onclick, onload 등 모든 on* 제거
        },
        // 외부 리소스 참조 제거 (XXE 방어)
        { name: 'removeXMLNS', active: false }, // namespace는 유지
      ],
    });
    if (result.error) {
      throw new Error('SVG 파싱 실패: ' + result.error);
    }
    fs.writeFileSync(filePath, result.data, 'utf8');
    const optimizedSize = Buffer.byteLength(result.data, 'utf8');
    return {
      originalSize,
      optimizedSize,
      savingsPercent: Math.round((1 - optimizedSize / originalSize) * 100),
      type: 'svg',
    };
  }

  // PNG/JPG: sharp 로 처리
  // limitInputPixels: Image Bomb (decompression bomb) 방어 — 25M 픽셀 = 5000x5000
  const meta = await sharp(filePath, { limitInputPixels: 25_000_000 }).metadata();

  // 차원 검증 (위 limitInputPixels 와 별도로 한 번 더)
  if (!meta.width || !meta.height) {
    throw new Error('이미지 메타데이터를 읽을 수 없습니다');
  }
  if (meta.width > 5000 || meta.height > 5000) {
    throw new Error(`이미지가 너무 큽니다 (${meta.width}x${meta.height}, 최대 5000x5000)`);
  }

  // 리사이즈 + 압축 — 로고가 작게 표시되는 문제 해결
  // 1) trim(): 가장자리 흰색/투명 여백 자동 제거 → 콘텐츠가 박스 꽉 채움
  // 2) resize: 가로 600px 이하 (Retina + 큰 화면 대응)
  // 3) withoutEnlargement: 작은 이미지 확대 안 함 (화질 보호)
  const optimized = await sharp(filePath, { limitInputPixels: 25_000_000 })
    .trim({ threshold: 10 }) // 가장자리 동일 색상 자동 제거 (threshold: 색차 허용도)
    .resize({
      width: 600, // 가로 600px (실제 표시 240px 의 2.5배 — 큰 화면 / Retina 대응)
      height: 200,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({
      quality: 90,
      compressionLevel: 9,
      adaptiveFiltering: true,
    })
    .toBuffer();

  // trim 후 실제 dimension 확인 (UI에 정보 표시)
  let finalMeta = meta;
  try {
    finalMeta = await sharp(optimized).metadata();
  } catch (_) {
    /* meta 조회 실패해도 진행 */
  }

  fs.writeFileSync(filePath, optimized);
  const optimizedSize = optimized.length;
  return {
    originalSize,
    optimizedSize,
    savingsPercent: Math.round((1 - optimizedSize / originalSize) * 100),
    width: finalMeta.width || meta.width,
    height: finalMeta.height || meta.height,
    originalDimensions: `${meta.width}x${meta.height}`,
    trimmed: finalMeta.width !== meta.width || finalMeta.height !== meta.height,
    type: 'raster',
  };
}

// ─── GET /api/system/logo — 현재 로고 URL (public) ──────────
router.get('/', async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'logo_path' LIMIT 1`
    );
    const customPath = row?.setting_value || null;
    res.json({
      success: true,
      data: {
        url: customPath || DEFAULT_LOGO_URL,
        is_custom: !!customPath,
      },
    });
  } catch (_err) {
    // 안전 fallback — DB 조회 실패 시에도 기본 로고 반환
    res.json({
      success: true,
      data: { url: DEFAULT_LOGO_URL, is_custom: false },
    });
  }
});

// ─── POST /api/admin/logo/upload — 로고 업로드 + 자동 최적화 ──
router.post('/upload', upload.logo.single('logo'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: 'logo 파일이 필요합니다 (PNG/JPG/SVG, 2MB 이하)' });
    }

    filePath = req.file.path;
    const ext = path.extname(req.file.filename).toLowerCase();

    // 1) Magic Bytes 검증 (Polyglot 파일 차단 — 확장자 위장 방어)
    if (!validateMagicBytes(filePath, ext)) {
      fs.unlinkSync(filePath); // 의심 파일 즉시 삭제
      return res.status(400).json({
        success: false,
        error: '파일 형식이 올바르지 않습니다 (헤더 검증 실패) — 다른 파일을 시도하세요',
      });
    }

    // 2) 자동 최적화 (Sharp + svgo)
    //    - PNG/JPG: 480x160 리사이즈 + 압축 + EXIF 제거
    //    - SVG: svgo sanitize (script + on* 이벤트 제거) + 압축
    let optResult;
    try {
      optResult = await optimizeImage(filePath, ext);
    } catch (optErr) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        error: '이미지 최적화 실패: ' + optErr.message,
      });
    }

    // /uploads/logos/logo-1234567890.png 형식 URL 생성
    const filename = req.file.filename;
    const newUrl = `/uploads/logos/${filename}`;

    // 3) 이전 로고 파일 정리 (default 가 아닌 경우)
    const [[old]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'logo_path' LIMIT 1`
    );
    if (old?.setting_value && old.setting_value.startsWith('/uploads/logos/')) {
      const oldPath = path.join(
        __dirname,
        '..',
        '..',
        'public',
        old.setting_value.replace(/^\//, '')
      );
      try {
        fs.unlinkSync(oldPath);
      } catch (_) {
        /* 이미 삭제됨 — 무시 */
      }
    }

    // 4) system_settings 에 새 경로 저장 (UPSERT)
    await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES ('logo_path', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [newUrl]
    );

    // 5) GET / 핸들러용 로고 캐시 즉시 invalidate (다음 페이지 로드 즉시 반영)
    logoCache.invalidate();

    res.json({
      success: true,
      data: {
        url: newUrl,
        filename,
        optimization: {
          original_size: optResult.originalSize,
          optimized_size: optResult.optimizedSize,
          savings_percent: optResult.savingsPercent,
          type: optResult.type,
          width: optResult.width,
          height: optResult.height,
        },
      },
    });
  } catch (err) {
    // 실패 시 업로드된 파일 정리
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (_) {}
    }
    handleError(res, err);
  }
});

// ─── DELETE /api/admin/logo — 기본 로고로 복원 ──────────────
router.delete('/', async (req, res) => {
  try {
    // 현재 커스텀 로고 파일 삭제
    const [[old]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'logo_path' LIMIT 1`
    );
    if (old?.setting_value && old.setting_value.startsWith('/uploads/logos/')) {
      const oldPath = path.join(
        __dirname,
        '..',
        '..',
        'public',
        old.setting_value.replace(/^\//, '')
      );
      try {
        fs.unlinkSync(oldPath);
      } catch (_) {}
    }

    // setting 자체 삭제 (NULL 또는 row 제거)
    await pool.query(`DELETE FROM system_settings WHERE setting_key = 'logo_path'`);

    // GET / 핸들러용 로고 캐시 즉시 invalidate
    logoCache.invalidate();

    res.json({
      success: true,
      data: { url: DEFAULT_LOGO_URL, restored: true },
    });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
