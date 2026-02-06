import { useState, type FormEvent, type ChangeEvent } from 'react';
import { adminApi } from '../services/api';

interface EventFormData {
  mainCategory: string;
  title: string;
  displayTitle: string;
  startAt: string;
  endAt: string;
  venue: string;
  address: string;
  // 지오코딩 결과
  lat?: number | null;
  lng?: number | null;
  region?: string | null;
  // 이미지
  imageUrl: string;
  overview: string;
  isFree: boolean;
  priceInfo: string;
  // 팝업 전용 필드
  instagramUrl: string;
  imageStorage: 'cdn' | 'external' | null;
  imageOrigin: 'brand_official' | 'reposter' | 'user_upload' | null;
  imageSourcePageUrl: string;
  imageKey?: string;
  imageMetadata?: {
    width: number;
    height: number;
    sizeKB: number;
    format: string;
    fileHash: string;
    uploadedAt: string;
  };
  // Phase 1 공통 필드
  externalLinks?: {
    official?: string;
    ticket?: string;
    instagram?: string;
    reservation?: string;
  };
  priceMin?: number | null;
  priceMax?: number | null;
  sourceTags?: string[];
  derivedTags?: string[];
  openingHours?: Record<string, string>;
}

interface EventFormProps {
  initialData?: Partial<EventFormData>;
  onSuccess?: () => void;
  onCancel?: () => void;
  hotSuggestionId?: string; // Hot Suggestion 승인 시
}

export default function EventForm({ initialData, onSuccess, onCancel, hotSuggestionId }: EventFormProps) {
  const [loading, setLoading] = useState(false);
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [agreedCopyright, setAgreedCopyright] = useState(false);
  const [autoFillStatus, setAutoFillStatus] = useState<Record<string, boolean>>({});

  const [formData, setFormData] = useState<EventFormData>(() => ({
    mainCategory: initialData?.mainCategory || '팝업',
    title: initialData?.title || '',
    displayTitle: initialData?.displayTitle || '',
    startAt: initialData?.startAt || new Date().toISOString().split('T')[0],
    endAt: initialData?.endAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    venue: initialData?.venue || '',
    address: initialData?.address || '',
    lat: initialData?.lat || null,
    lng: initialData?.lng || null,
    region: initialData?.region || null,
    imageUrl: initialData?.imageUrl || '',
    overview: initialData?.overview || '',
    isFree: initialData?.isFree ?? true,
    priceInfo: initialData?.priceInfo || '입장 무료',
    instagramUrl: initialData?.instagramUrl || '',
    imageStorage: initialData?.imageStorage || null,
    imageOrigin: initialData?.imageOrigin || null,
    imageSourcePageUrl: initialData?.imageSourcePageUrl || '',
    externalLinks: initialData?.externalLinks || { official: '', ticket: '', instagram: '', reservation: '' },
    priceMin: initialData?.priceMin || null,
    priceMax: initialData?.priceMax || null,
    sourceTags: initialData?.sourceTags || [],
    derivedTags: initialData?.derivedTags || [],
    openingHours: initialData?.openingHours || {},
  }));

  const handleAutoFill = async () => {
    if (!formData.title) {
      alert('제목을 먼저 입력하세요!');
      return;
    }

    setAutoFillLoading(true);
    setAutoFillStatus({});

    try {
      const result = await adminApi.enrichEventPreview({
        title: formData.title,
        venue: formData.venue || undefined,
        main_category: formData.mainCategory || undefined,
        overview: formData.overview || undefined,
      });

      if (!result.success || !result.enriched) {
        alert(result.message || 'AI 분석에 실패했습니다.');
        return;
      }

      const enriched = result.enriched;

      // 결과를 폼에 자동 입력
      setFormData((prev) => ({
        ...prev,
        // 기본 정보
        startAt: enriched.start_date || prev.startAt,
        endAt: enriched.end_date || prev.endAt,
        venue: enriched.venue || prev.venue,
        address: enriched.address || prev.address,
        overview: enriched.overview || prev.overview,
        
        // 지오코딩 결과
        lat: enriched.lat ?? prev.lat,
        lng: enriched.lng ?? prev.lng,
        region: enriched.region || prev.region,
        
        // 추가 정보
        derivedTags: enriched.derived_tags || prev.derivedTags,
        openingHours: enriched.opening_hours || prev.openingHours,
        priceMin: enriched.price_min ?? prev.priceMin,
        priceMax: enriched.price_max ?? prev.priceMax,
        externalLinks: {
          ...prev.externalLinks,
          ...enriched.external_links,
        },
      }));

      // 채워진 필드 표시
      setAutoFillStatus({
        startAt: !!enriched.start_date,
        endAt: !!enriched.end_date,
        venue: !!enriched.venue,
        address: !!enriched.address,
        overview: !!enriched.overview,
        derivedTags: !!enriched.derived_tags && enriched.derived_tags.length > 0,
        openingHours: !!enriched.opening_hours,
        priceMin: enriched.price_min !== null && enriched.price_min !== undefined,
        priceMax: enriched.price_max !== null && enriched.price_max !== undefined,
        externalLinks: !!enriched.external_links,
      });

      alert('✅ AI 자동 채우기 완료!');
    } catch (error: any) {
      console.error('[AutoFill] Error:', error);
      alert('AI 분석 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
    } finally {
      setAutoFillLoading(false);
    }
  };

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 클라이언트 검증
    if (file.size > 5 * 1024 * 1024) {
      alert('파일 크기는 5MB 이하여야 합니다');
      return;
    }

    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드 가능합니다');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const result = await adminApi.uploadImage(file, (progressEvent) => {
        const progress = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
        setUploadProgress(progress);
      });

      // 업로드 성공 → 폼 데이터 자동 입력
      setFormData((prev) => ({
        ...prev,
        imageUrl: result.url,
        imageStorage: 'cdn',
        imageKey: result.key,
        // imageOrigin이 비어있으면 기본값 'user_upload' 설정
        imageOrigin: prev.imageOrigin || 'user_upload',
        imageMetadata: {
          width: result.width,
          height: result.height,
          sizeKB: result.sizeKB,
          format: result.format,
          fileHash: result.fileHash,
          uploadedAt: result.uploadedAt,
        },
      }));

      alert('✅ 업로드 완료!');
    } catch (error: any) {
      console.error('[Upload] Error:', error);
      const errorMsg = error.response?.data?.error || '업로드 실패. 다시 시도해주세요.';
      alert(errorMsg);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    // 필수 필드 검증
    if (!formData.mainCategory) {
      alert('카테고리를 선택하세요!');
      return;
    }
    if (!formData.title) {
      alert('제목을 입력하세요!');
      return;
    }
    if (!formData.startAt || !formData.endAt) {
      alert('시작일과 종료일을 입력하세요!');
      return;
    }
    if (!formData.venue) {
      alert('장소를 입력하세요!');
      return;
    }

    // 팝업일 경우 추가 검증
    if (formData.mainCategory === '팝업') {
      if (!formData.imageUrl) {
        alert('팝업은 이미지가 필수입니다!');
        return;
      }
      if (formData.imageStorage === 'cdn' && !formData.imageOrigin) {
        alert('이미지 출처를 선택하세요!');
        return;
      }
      if (!agreedCopyright) {
        alert('저작권 관련 내용에 동의해주세요!');
        return;
      }
    }

    setLoading(true);

    try {
      if (formData.mainCategory === '팝업') {
        // 팝업 생성 API 사용
        await adminApi.createPopup({
          instagramUrl: formData.instagramUrl,
          title: formData.title,
          displayTitle: formData.displayTitle,
          startAt: formData.startAt,
          endAt: formData.endAt,
          venue: formData.venue,
          address: formData.address,
          imageUrl: formData.imageUrl,
          overview: formData.overview,
          imageStorage: formData.imageStorage || 'cdn',
          imageOrigin: formData.imageOrigin === 'brand_official' ? 'official_site' : (formData.imageOrigin === 'reposter' ? 'other' : formData.imageOrigin) || undefined,
          imageSourcePageUrl: formData.imageSourcePageUrl || '',
          imageKey: formData.imageKey,
          imageMetadata: formData.imageMetadata,
        });
      } else {
        // 빈 문자열/배열 제거 헬퍼 함수
        const cleanExternalLinks = (links: any) => {
          const cleaned: any = {};
          Object.entries(links || {}).forEach(([key, value]) => {
            if (value && typeof value === 'string' && value.trim() !== '') {
              cleaned[key] = value.trim();
            }
          });
          return Object.keys(cleaned).length > 0 ? cleaned : null;
        };

        const cleanOpeningHours = (hours: any) => {
          if (!hours) return null;
          const cleaned: any = {};
          Object.entries(hours).forEach(([key, value]) => {
            if (value && typeof value === 'string' && value.trim() !== '') {
              cleaned[key] = value.trim();
            }
          });
          return Object.keys(cleaned).length > 0 ? cleaned : null;
        };

        const cleanTags = (tags: any) => {
          if (!Array.isArray(tags)) return null;
          const cleaned = tags.filter(tag => tag && typeof tag === 'string' && tag.trim() !== '');
          return cleaned.length > 0 ? cleaned : null;
        };

        // 범용 이벤트 생성 API 사용
        await adminApi.createEvent({
          main_category: formData.mainCategory,
          title: formData.title,
          display_title: formData.displayTitle || null,
          start_at: formData.startAt,
          end_at: formData.endAt,
          venue: formData.venue,
          address: formData.address || null,
          // 지오코딩 결과
          lat: formData.lat,
          lng: formData.lng,
          region: formData.region,
          // 이미지
          image_url: formData.imageUrl || null,
          overview: formData.overview || null,
          is_free: formData.isFree,
          price_info: formData.priceInfo || null,
          // Phase 1 공통 필드 (빈 문자열/배열 제거)
          external_links: cleanExternalLinks(formData.externalLinks),
          price_min: formData.priceMin ?? null,
          price_max: formData.priceMax ?? null,
          source_tags: cleanTags(formData.sourceTags) || undefined,
          derived_tags: cleanTags(formData.derivedTags) || undefined,
          opening_hours: cleanOpeningHours(formData.openingHours),
        } as any);
      }
      
      // Hot Suggestion에서 왔으면 승인 처리
      if (hotSuggestionId) {
        try {
          await adminApi.approveHotSuggestion(hotSuggestionId);
          console.log('[HotSuggestion] Approved:', hotSuggestionId);
        } catch (error) {
          console.warn('[HotSuggestion] Approve failed (non-critical):', error);
        }
      }
      
      alert('✅ 이벤트가 생성되었습니다!');
      onSuccess?.();
    } catch (error) {
      alert('❌ 생성 실패. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 카테고리 선택 */}
      <section>
        <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🏷️ 카테고리</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            카테고리 *
          </label>
          <select
            value={formData.mainCategory}
            onChange={(e) => setFormData({ ...formData, mainCategory: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            required
          >
            <option value="">선택하세요</option>
            <option value="팝업">팝업</option>
            <option value="전시">전시</option>
            <option value="공연">공연</option>
            <option value="축제">축제</option>
            <option value="체험">체험</option>
            <option value="행사">행사</option>
            <option value="기타">기타</option>
          </select>
        </div>
      </section>

      {/* 기본 정보 */}
      <section>
        <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">📝 기본 정보</h3>
        
        {/* AI 자동 채우기 안내 */}
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
          <div className="flex items-start">
            <span className="text-2xl mr-3">🤖</span>
            <div className="flex-1">
              <p className="font-semibold text-purple-900">AI 자동 채우기</p>
              <p className="text-sm text-purple-700 mt-1">
                제목을 입력 후 "AI 자동 채우기"를 클릭하면 네이버 검색 + Gemini AI로 시작일, 종료일, 장소, 주소, 좌표, 개요, 태그, 가격, 운영시간, 예매 링크를 자동으로 채웁니다.
              </p>
            </div>
            <button
              type="button"
              onClick={handleAutoFill}
              disabled={!formData.title || autoFillLoading}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 ml-4"
            >
              {autoFillLoading ? '🔄 분석 중...' : '🤖 AI 자동 채우기'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              제목 *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="이벤트 제목"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              시작일 * {autoFillStatus.startAt && <span className="text-green-600 text-xs">✅ AI 채움</span>}
            </label>
            <input
              type="date"
              value={formData.startAt}
              onChange={(e) => setFormData({ ...formData, startAt: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              종료일 * {autoFillStatus.endAt && <span className="text-green-600 text-xs">✅ AI 채움</span>}
            </label>
            <input
              type="date"
              value={formData.endAt}
              onChange={(e) => setFormData({ ...formData, endAt: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              required
            />
          </div>
        </div>
      </section>

      {/* 위치 정보 */}
      <section>
        <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">📍 위치</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              장소 * {autoFillStatus.venue && <span className="text-green-600 text-xs">✅ AI 채움</span>}
            </label>
            <input
              type="text"
              value={formData.venue}
              onChange={(e) => setFormData({ ...formData, venue: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="예: 롯데월드몰"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              주소 (선택) {autoFillStatus.address && <span className="text-green-600 text-xs">✅ AI 채움 + 지오코딩</span>}
            </label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="서울 성동구 서울숲2길 32-14"
            />
          </div>

          {/* 지오코딩 결과 (읽기 전용) */}
          {(formData.lat || formData.lng || formData.region) && (
            <div className="grid grid-cols-3 gap-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div>
                <label className="block text-xs font-medium text-blue-700 mb-1">지역 (자동)</label>
                <div className="text-sm font-semibold text-blue-900">
                  {formData.region || '-'}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-blue-700 mb-1">위도 (자동)</label>
                <div className="text-sm font-mono text-blue-900">
                  {formData.lat ? formData.lat.toFixed(6) : '-'}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-blue-700 mb-1">경도 (자동)</label>
                <div className="text-sm font-mono text-blue-900">
                  {formData.lng ? formData.lng.toFixed(6) : '-'}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 이미지 */}
      <section>
        <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🖼️ 이미지</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              이미지 업로드 (선택)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              disabled={isUploading}
              className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 disabled:opacity-50"
            />
            {isUploading && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                  <span>업로드 중...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          {/* 이미지 미리보기 */}
          {formData.imageUrl && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">미리보기</label>
              <img
                src={formData.imageUrl}
                alt="Preview"
                className="w-full h-64 object-cover rounded-lg border"
              />
            </div>
          )}
        </div>
      </section>

      {/* 설명 */}
      <section>
        <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">📄 설명</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            개요 (선택) {autoFillStatus.overview && <span className="text-green-600 text-xs">✅ AI 작성</span>}
          </label>
          <textarea
            value={formData.overview}
            onChange={(e) => setFormData({ ...formData, overview: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            rows={5}
            placeholder="이벤트에 대한 설명을 입력하세요"
          />
        </div>
      </section>

      {/* 저작권 동의 (팝업 전용) */}
      {formData.mainCategory === '팝업' && (
        <section>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={agreedCopyright}
                onChange={(e) => setAgreedCopyright(e.target.checked)}
                className="mr-3 h-5 w-5 mt-0.5"
              />
              <div>
                <p className="font-medium text-gray-900">
                  이 이미지는 브랜드/기관의 공식 홍보 이미지이거나, 직접 촬영한 것임을 확인합니다.
                </p>
                <p className="text-sm text-red-600 mt-2">
                  <strong>저작권 침해 발생 시 업로더가 법적 책임을 집니다.</strong>
                </p>
              </div>
            </label>
          </div>
        </section>
      )}

      {/* Actions */}
      <div className="flex gap-4 pt-4">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? '생성 중...' : '✅ 승인 & 이벤트 생성'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            취소
          </button>
        )}
      </div>
    </form>
  );
}

