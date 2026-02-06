import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import crypto from 'crypto';
import { config } from '../config';

// ============================================================================
// S3/R2 클라이언트 설정
// ============================================================================

const s3Client = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint, // R2 사용 시 필수, AWS S3는 undefined 가능
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
  forcePathStyle: true, // ✅ Cloudflare R2 필수(서명/호스트 꼬임 방지)
});

// ============================================================================
// 타입 정의
// ============================================================================

export interface UploadResult {
  url: string;
  key: string;
  width: number;
  height: number;
  sizeKB: number;
  format: string;
  fileHash: string;
  uploadedAt: string;
  deduplicated?: boolean;
}

export class ImageUploadError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ImageUploadError';
  }
}

// ============================================================================
// 업로드 함수
// ============================================================================

/**
 * 이미지 업로드 (최적화 + S3/R2 저장)
 * 
 * @param buffer 이미지 파일 버퍼
 * @param originalName 원본 파일명
 * @param options 옵션 (중복 체크, 이벤트 ID 등)
 * @returns 업로드 결과 (URL, key, 메타데이터)
 */
export async function uploadEventImage(
  buffer: Buffer,
  originalName: string,
  options: {
    checkDuplicate?: boolean;
    eventId?: string;
  } = {}
): Promise<UploadResult> {
  try {
    // 1. 파일 해시 계산 (중복 체크용)
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
    
    // 2. 중복 체크 (선택적)
    // TODO: 중복 체크 로직은 향후 추가 (초기엔 skip)
    
    // 3. MIME 타입 검증 (파일 시그니처 기반)
    const fileType = await fileTypeFromBuffer(buffer);
    
    console.log('[ImageUpload] File type detection:', {
      detected: fileType?.mime || 'unknown',
      ext: fileType?.ext || 'unknown',
      size: buffer.length,
      firstBytes: buffer.slice(0, 20).toString('hex'),
    });
    
    if (!fileType) {
      throw new ImageUploadError('INVALID_TYPE', '파일 형식을 인식할 수 없습니다 (매직 넘버 미확인)');
    }
    
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(fileType.mime)) {
      throw new ImageUploadError(
        'INVALID_TYPE',
        `지원하지 않는 파일 형식입니다. 허용: JPG, PNG, WebP (현재: ${fileType.mime})`
      );
    }
    
    // 4. 파일 크기 체크 (5MB)
    const maxSize = 5 * 1024 * 1024;
    if (buffer.length > maxSize) {
      throw new ImageUploadError(
        'TOO_LARGE',
        `파일 크기는 5MB 이하여야 합니다 (현재: ${(buffer.length / 1024 / 1024).toFixed(2)}MB)`
      );
    }
    
    // 5. 이미지 최적화 (리사이즈 + WebP 변환)
    const optimized = await sharp(buffer)
      .resize(1200, 1200, { 
        fit: 'inside',                // 비율 유지하며 안쪽에 맞춤
        withoutEnlargement: true,     // 작은 이미지는 확대하지 않음
      })
      .webp({ 
        quality: 85,                  // WebP 품질 (85 = 고품질)
        effort: 4,                    // 압축 노력 (0-6, 4=균형)
      })
      .toBuffer({ resolveWithObject: true });
    
    console.log('[ImageUpload] Optimization complete:', {
      originalSize: `${(buffer.length / 1024).toFixed(1)}KB`,
      optimizedSize: `${(optimized.data.length / 1024).toFixed(1)}KB`,
      reduction: `${((1 - optimized.data.length / buffer.length) * 100).toFixed(1)}%`,
      dimensions: `${optimized.info.width}x${optimized.info.height}`,
    });
    
    // 6. S3/R2 키 생성 (events/YYYY/MM/uuid.webp)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const uuid = crypto.randomUUID();
    const key = `events/${year}/${month}/${uuid}.webp`;
    
    // 7. S3/R2 업로드
    // 한글 파일명을 Base64로 인코딩하여 AWS 서명 문제 방지
    const safeFilename = Buffer.from(originalName.substring(0, 100)).toString('base64');
    
    await s3Client.send(new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: optimized.data,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable', // 1년 캐시
      Metadata: {
        originalName: safeFilename, // Base64 인코딩된 파일명
        fileHash: fileHash.substring(0, 64),
        eventId: options.eventId || '',
        uploadedAt: now.toISOString(),
      },
    }));
    
    console.log('[ImageUpload] S3/R2 upload complete:', { key });
    
    // 8. CDN URL 생성
    const url = `${config.cdnBaseUrl}/${key}`;
    
    // 9. 결과 반환
    return {
      url,
      key,
      width: optimized.info.width,
      height: optimized.info.height,
      sizeKB: Math.round(optimized.data.length / 1024),
      format: 'webp',
      fileHash,
      uploadedAt: now.toISOString(),
    };
    
  } catch (error: any) {
    // 에러 처리
    if (error instanceof ImageUploadError) {
      throw error;
    }
    
    // Sharp 에러
    if (error.message?.includes('Input buffer')) {
      throw new ImageUploadError('INVALID_IMAGE', '손상된 이미지 파일입니다');
    }
    
    // S3/R2 에러
    if (error.name === 'S3ServiceException' || error.$metadata) {
      console.error('[ImageUpload] S3/R2 error:', error);
      throw new ImageUploadError('UPLOAD_FAIL', 'CDN 업로드에 실패했습니다');
    }
    
    // 기타 에러
    console.error('[ImageUpload] Unexpected error:', error);
    throw new ImageUploadError('UPLOAD_FAIL', `업로드 실패: ${error.message}`);
  }
}

// ============================================================================
// 삭제 함수
// ============================================================================

/**
 * S3/R2에서 이미지 삭제
 * 
 * @param key S3/R2 오브젝트 key
 */
export async function deleteEventImage(key: string): Promise<void> {
  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    }));
    
    console.log('[ImageUpload] Deleted from CDN:', key);
  } catch (error: any) {
    console.error('[ImageUpload] Delete failed:', error);
    throw new Error(`이미지 삭제 실패: ${error.message}`);
  }
}

// ============================================================================
// 검증 함수
// ============================================================================

/**
 * S3/R2 설정이 올바른지 검증
 */
export function validateS3Config(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!config.s3.bucket) {
    errors.push('S3_BUCKET 환경변수가 설정되지 않았습니다');
  }
  
  if (!config.s3.accessKeyId) {
    errors.push('S3_ACCESS_KEY 환경변수가 설정되지 않았습니다');
  }
  
  if (!config.s3.secretAccessKey) {
    errors.push('S3_SECRET_KEY 환경변수가 설정되지 않았습니다');
  }
  
  if (!config.cdnBaseUrl) {
    errors.push('CDN_BASE_URL 환경변수가 설정되지 않았습니다');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

