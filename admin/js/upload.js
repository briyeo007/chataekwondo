// 이미지 업로드: 형식·크기 검사 → 브라우저에서 축소·재인코딩(JPEG) → 서버(사진 저장소) 업로드.
// 재인코딩하면 위치정보(EXIF GPS) 같은 메타데이터와 이미지에 숨긴 악성 데이터가 제거된다.
import { db } from './api.js';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_INPUT = 30 * 1024 * 1024; // 원본 30MB
const MAX_EDGE = 2000;               // 긴 변 최대 2000px
const QUALITY = 0.85;
const MAX_UPLOAD = 4 * 1024 * 1024; // 서버 요청 한도 이내

export function checkFile(file) {
  if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)) {
    return '아이폰 HEIC 사진은 지원하지 않습니다. 사진 앱에서 "JPG로 내보내기" 하거나, 휴대폰에서 바로 올려 주세요.';
  }
  if (!ALLOWED.includes(file.type)) return `${file.name}: JPG, PNG, WEBP 사진만 올릴 수 있습니다.`;
  if (file.size > MAX_INPUT) return `${file.name}: 파일이 너무 큽니다 (최대 30MB).`;
  return null;
}

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // 일부 브라우저 대비
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** 축소·재인코딩된 JPEG Blob */
export async function processImage(file) {
  const err = checkFile(file);
  if (err) throw new Error(err);
  let bmp;
  try { bmp = await decode(file); } catch { throw new Error(`${file.name}: 이미지 파일이 아니거나 손상되었습니다.`); }
  const w = bmp.width, h = bmp.height;
  // 4MB를 넘으면 크기·품질을 낮춰 다시 변환
  for (const [edge, quality] of [[MAX_EDGE, QUALITY], [MAX_EDGE, 0.7], [1600, 0.7], [1200, 0.65]]) {
    const scale = Math.min(1, edge / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // 투명 배경 PNG → 흰 배경
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) throw new Error(`${file.name}: 이미지 변환에 실패했습니다.`);
    if (blob.size <= MAX_UPLOAD) { bmp.close?.(); return blob; }
  }
  bmp.close?.();
  throw new Error(`${file.name}: 사진이 너무 큽니다.`);
}

/**
 * @param {File} file
 * @param {'gallery'|'posts'|'pages'} folder
 * @returns {Promise<{url:string, path:string}>}
 */
export async function uploadImage(file, folder) {
  const blob = await processImage(file);
  return db.upload(blob, folder);
}

/** 파일 선택 창 열기 */
export function pickFiles({ multiple = false } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...input.files]));
    input.click();
  });
}

/** 업로드 전 미리보기용 URL */
export function previewUrl(file) {
  return URL.createObjectURL(file);
}
