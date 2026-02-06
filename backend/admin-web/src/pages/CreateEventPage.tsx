import { useState, type FormEvent, type ChangeEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  // 🆕 카테고리별 특화 필드
  metadata?: {
    display?: {
      exhibition?: any;
      performance?: any;
      festival?: any;
      event?: any;
      popup?: any;
    };
  };
}

export default function CreateEventPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [agreedCopyright, setAgreedCopyright] = useState(false);
  const [autoFillStatus, setAutoFillStatus] = useState<Record<string, boolean>>({});
  
  // Hot Suggestion에서 전달된 데이터
  const hotSuggestionState = location.state as {
    fromHotSuggestion?: boolean;
    hotSuggestionId?: string;
    hotSuggestionData?: {
      title: string;
      venue?: string;
      region?: string;
      description?: string;
      evidenceLinks?: string[];
      evidenceCount?: number;
    };
  } | null;

  const [formData, setFormData] = useState<EventFormData>(() => {
    // Hot Suggestion 데이터가 있으면 초기값으로 설정
    if (hotSuggestionState?.fromHotSuggestion && hotSuggestionState.hotSuggestionData) {
      const data = hotSuggestionState.hotSuggestionData;
      return {
        mainCategory: '팝업', // 기본값 (수정 가능)
        title: data.title || '',
        displayTitle: '',
        startAt: new Date().toISOString().split('T')[0],
        endAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30일 후
        venue: data.venue || '',
        address: '',
        // 지오코딩 결과
        lat: null,
        lng: null,
        region: data.region || null,
        // 이미지
        imageUrl: '',
        overview: data.description || '',
        isFree: true,
        priceInfo: '입장 무료',
        // 팝업 전용 필드
        instagramUrl: '',
        imageStorage: null,
        imageOrigin: null,
        imageSourcePageUrl: data.evidenceLinks?.[0] || '', // 첫 번째 증거 링크를 출처로
        // Phase 1 공통 필드
        externalLinks: { 
          official: data.evidenceLinks?.[0] || '', 
          ticket: '', 
          instagram: '', 
          reservation: '' 
        },
        priceMin: null,
        priceMax: null,
        sourceTags: [],
        derivedTags: [],
        openingHours: {},
      };
    }
    
    // 일반 모드
    return {
      mainCategory: '',
      title: '',
      displayTitle: '',
      startAt: '',
      endAt: '',
      venue: '',
      address: '',
      // 지오코딩 결과
      lat: null,
      lng: null,
      region: null,
      // 이미지
      imageUrl: '',
      overview: '',
      isFree: true,
      priceInfo: '입장 무료',
      // 팝업 전용 필드
      instagramUrl: '',
      imageStorage: null,
      imageOrigin: null,
      imageSourcePageUrl: '',
      // Phase 1 공통 필드
      externalLinks: { official: '', ticket: '', instagram: '', reservation: '' },
      priceMin: null,
      priceMax: null,
      sourceTags: [],
      derivedTags: [],
      openingHours: {},
    };
  });

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

      // 성공 메시지
      const filledFields: string[] = [];
      if (enriched.start_date) filledFields.push('시작일');
      if (enriched.end_date) filledFields.push('종료일');
      if (enriched.venue) filledFields.push('장소');
      if (enriched.address) filledFields.push('주소');
      if (enriched.lat && enriched.lng) filledFields.push('좌표');
      if (enriched.overview) filledFields.push('개요');
      if (enriched.derived_tags?.length) filledFields.push('태그');
      if (enriched.opening_hours) filledFields.push('운영시간');
      if (enriched.price_min !== null || enriched.price_max !== null) filledFields.push('가격');
      if (enriched.external_links) filledFields.push('예매링크');

      alert(`✅ AI 자동 채우기 완료!\n\n채워진 항목: ${filledFields.join(', ')}`);
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

      const alertMsg = formData.mainCategory === '팝업' 
        ? `✅ 업로드 완료! (${result.sizeKB}KB, WebP)\n출처를 반드시 선택하세요.`
        : `✅ 업로드 완료! (${result.sizeKB}KB, WebP)`;
      alert(alertMsg);
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
      if (hotSuggestionState?.fromHotSuggestion && hotSuggestionState.hotSuggestionId) {
        try {
          await adminApi.approveHotSuggestion(hotSuggestionState.hotSuggestionId);
          console.log('[HotSuggestion] Approved:', hotSuggestionState.hotSuggestionId);
        } catch (error) {
          console.warn('[HotSuggestion] Approve failed (non-critical):', error);
        }
      }
      
      alert('✅ 이벤트가 생성되었습니다!');
      navigate('/events');
    } catch (error) {
      alert('❌ 생성 실패. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFormData({
      mainCategory: '',
      title: '',
      displayTitle: '',
      startAt: '',
      endAt: '',
      venue: '',
      address: '',
      lat: null,
      lng: null,
      region: null,
      imageUrl: '',
      overview: '',
      isFree: true,
      priceInfo: '입장 무료',
      instagramUrl: '',
      imageStorage: null,
      imageOrigin: null,
      imageSourcePageUrl: '',
      // Phase 1 공통 필드
      externalLinks: { official: '', ticket: '', instagram: '', reservation: '' },
      priceMin: null,
      priceMax: null,
      sourceTags: [],
      derivedTags: [],
      openingHours: {},
    });
    setAgreedCopyright(false);
    setAutoFillStatus({});
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        {hotSuggestionState?.fromHotSuggestion ? (
          <>
            <h2 className="text-3xl font-bold text-gray-900">🔥 Hot Suggestion 승인</h2>
            <p className="text-gray-600 mt-2">
              AI가 발굴한 이벤트를 검토하고 수정 후 저장하세요
              {hotSuggestionState.hotSuggestionData?.evidenceCount && (
                <span className="ml-2 px-2 py-1 bg-green-100 text-green-700 text-sm rounded">
                  🔗 증거 {hotSuggestionState.hotSuggestionData.evidenceCount}개
                </span>
              )}
            </p>
          </>
        ) : (
          <>
            <h2 className="text-3xl font-bold text-gray-900">새 이벤트 추가</h2>
            <p className="text-gray-600 mt-2">모든 카테고리의 이벤트를 수동으로 추가할 수 있습니다</p>
          </>
        )}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="card">
        <div className="space-y-6">
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
                className="input"
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
              <p className="mt-2 text-sm text-gray-500">
                이벤트의 카테고리를 선택하세요
              </p>
            </div>
          </section>

          {/* Instagram URL (팝업 전용) */}
          {formData.mainCategory === '팝업' && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">📸 Instagram</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Instagram URL (선택)
                </label>
                <input
                  type="url"
                  value={formData.instagramUrl}
                  onChange={(e) => setFormData({ ...formData, instagramUrl: e.target.value })}
                  className="input"
                  placeholder="https://instagram.com/p/..."
                />
                <p className="mt-2 text-sm text-gray-500">
                  팝업 홍보용 Instagram 게시물 URL을 입력하세요
                </p>
              </div>
            </section>
          )}

          {/* 기본 정보 */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">📝 기본 정보</h3>
            
            {/* AI 자동 채우기 안내 */}
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
              <div className="flex items-start flex-col gap-3">
                <div className="flex items-start w-full">
                  <span className="text-2xl mr-3">🤖</span>
                  <div className="flex-1">
                    <p className="font-semibold text-purple-900">AI 자동 채우기</p>
                    <p className="text-sm text-purple-700 mt-1">
                      제목을 입력 후 원하는 AI 보완 방식을 선택하세요
                    </p>
                  </div>
                </div>
                
                {/* 4개 버튼 */}
                <div className="flex gap-2 flex-wrap w-full">
                  <button
                    type="button"
                    onClick={handleAutoFill}
                    disabled={!formData.title || autoFillLoading}
                    className="btn btn-secondary text-sm flex items-center gap-2"
                  >
                    {autoFillLoading ? '🔄 분석 중...' : '🤖 빈 필드만 AI 보완'}
                  </button>
                  <button
                    type="button"
                    onClick={() => alert('이 기능은 이벤트 생성 후 상세 페이지에서 사용할 수 있습니다.')}
                    disabled={!formData.title}
                    className="btn btn-outline text-sm flex items-center gap-2"
                  >
                    🎯 선택한 필드만 재생성
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('⚠️ 경고: 모든 필드를 강제로 재생성합니다.\n수동으로 입력한 데이터도 덮어씌워집니다.\n\n계속하시겠습니까?')) {
                        handleAutoFill();
                      }
                    }}
                    disabled={!formData.title || autoFillLoading}
                    className="btn btn-danger text-sm flex items-center gap-2"
                  >
                    🚨 강제 재생성
                  </button>
                  <button
                    type="button"
                    onClick={() => alert('⚠️ 이 기능은 이벤트를 먼저 저장한 후 사용할 수 있습니다.\n\n이벤트 관리 페이지에서 이벤트를 선택하고 "AI만으로 빈 필드 보완" 버튼을 사용해주세요.')}
                    disabled={true}
                    className="btn btn-secondary text-sm flex items-center gap-2 opacity-50 cursor-not-allowed"
                  >
                    🔍 AI만으로 빈 필드 보완
                  </button>
                </div>
                
                <p className="text-xs text-gray-600 w-full">
                  💡 <strong>빈 필드만 AI 보완:</strong> 네이버 검색 + AI로 기본 정보 자동 채우기<br/>
                  💡 <strong>선택한 필드만 재생성:</strong> 특정 필드만 골라서 AI 재생성 (이벤트 생성 후 사용 가능)<br/>
                  💡 <strong>강제 재생성:</strong> 모든 필드를 AI로 덮어쓰기<br/>
                  💡 <strong>AI만으로 빈 필드 보완:</strong> 네이버 없이 AI 직접 검색 (포토존, 대기시간 등 상세 정보)
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  제목 * {autoFillStatus.title && <span className="text-green-600 text-xs">✅ AI 채움</span>}
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="input"
                  placeholder="이벤트 제목 (예: 롯데월드 벚꽃축제)"
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  표시 제목 (Display Title)
                </label>
                <input
                  type="text"
                  value={formData.displayTitle}
                  onChange={(e) => setFormData({ ...formData, displayTitle: e.target.value })}
                  className="input"
                  placeholder="비워두면 제목과 동일하게 사용됩니다"
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
                  className="input"
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
                  className="input"
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
                  className="input"
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
                  className="input"
                  placeholder="서울 성동구 서울숲2길 32-14"
                />
                <p className="mt-2 text-sm text-gray-500">
                  AI가 주소를 추출하면 자동으로 좌표(위도/경도)도 계산됩니다
                </p>
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
                  className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-50"
                />
                {isUploading && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                      <span>업로드 중...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  </div>
                )}
                <p className="mt-2 text-sm text-gray-500">
                  JPG, PNG 형식 / 최대 5MB / WebP로 자동 변환
                </p>
              </div>

              {/* 이미지 출처 정보 - 업로드 후 표시 */}
              {formData.imageUrl && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      이미지 출처 {formData.mainCategory === '팝업' ? <span className="text-red-600">*</span> : <span className="text-gray-500">(권장)</span>}
                    </label>
                    <select
                      value={formData.imageOrigin || ''}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        imageOrigin: e.target.value as 'brand_official' | 'reposter' | 'user_upload' 
                      })}
                      className="input"
                      required={formData.mainCategory === '팝업'}
                    >
                      <option value="">선택하세요</option>
                      <option value="brand_official">브랜드 공식 홍보물</option>
                      <option value="reposter">리포스터 (재게시 계정)</option>
                      <option value="user_upload">직접 촬영</option>
                    </select>
                    <p className="mt-2 text-sm text-gray-500">
                      {!formData.imageOrigin && '이미지를 어디서 가져왔는지 선택해주세요'}
                      {formData.imageOrigin === 'brand_official' && '✅ 브랜드가 공식적으로 배포한 홍보 이미지'}
                      {formData.imageOrigin === 'reposter' && '⚠️ 리포스터가 재게시한 이미지 (브랜드 출처 명시 필요)'}
                      {formData.imageOrigin === 'user_upload' && '📸 사용자가 직접 촬영한 이미지'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      출처 페이지 URL {formData.mainCategory === '팝업' ? <span className="text-orange-600">(강력 권장)</span> : <span className="text-gray-500">(선택)</span>}
                    </label>
                    <input
                      type="url"
                      value={formData.imageSourcePageUrl}
                      onChange={(e) => setFormData({ ...formData, imageSourcePageUrl: e.target.value })}
                      className="input"
                      placeholder="https://place.naver.com/... 또는 https://instagram.com/p/..."
                    />
                    <p className="mt-2 text-sm text-gray-500">
                      이미지를 가져온 페이지 URL을 입력하세요 (저작권 추적용)
                    </p>
                  </div>
                </>
              )}

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
                className="input"
                rows={5}
                placeholder="이벤트에 대한 설명을 입력하세요 (AI가 자동으로 작성합니다)"
              />
              <p className="mt-2 text-sm text-gray-500">
                AI가 네이버 검색 결과를 바탕으로 2-3문장으로 요약합니다
              </p>
            </div>
          </section>

          {/* 가격 정보 */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">💰 가격 정보</h3>
            <div className="space-y-4">
              <div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.isFree}
                    onChange={(e) => setFormData({ ...formData, isFree: e.target.checked })}
                    className="mr-2 h-5 w-5"
                  />
                  <span className="font-medium">무료 이벤트</span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  가격 정보 (선택)
                </label>
                <input
                  type="text"
                  value={formData.priceInfo}
                  onChange={(e) => setFormData({ ...formData, priceInfo: e.target.value })}
                  className="input"
                  placeholder="예: 입장 무료, 5,000원~10,000원"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    최소 가격 (원)
                  </label>
                  <input
                    type="number"
                    value={formData.priceMin || ''}
                    onChange={(e) => setFormData({ ...formData, priceMin: e.target.value ? parseInt(e.target.value) : null })}
                    className="input"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    최대 가격 (원)
                  </label>
                  <input
                    type="number"
                    value={formData.priceMax || ''}
                    onChange={(e) => setFormData({ ...formData, priceMax: e.target.value ? parseInt(e.target.value) : null })}
                    className="input"
                    placeholder="100000"
                  />
                </div>
              </div>
              <p className="text-sm text-gray-500">
                필터링/정렬을 위한 가격 범위 (예: 무료=0~0, 유료=30000~50000)
              </p>
            </div>
          </section>

          {/* 추가 정보 (Phase 1 공통 필드) */}
          <section>
            <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">
              🔗 추가 정보
              {autoFillStatus.externalLinks && <span className="text-green-600 text-sm ml-2">✅ AI 채움</span>}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  공식 홈페이지
                </label>
                <input
                  type="url"
                  value={formData.externalLinks?.official || ''}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    externalLinks: { ...formData.externalLinks, official: e.target.value }
                  })}
                  className="input"
                  placeholder="https://example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  예매/티켓 링크
                </label>
                <input
                  type="url"
                  value={formData.externalLinks?.ticket || ''}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    externalLinks: { ...formData.externalLinks, ticket: e.target.value }
                  })}
                  className="input"
                  placeholder="https://tickets.example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  예약 링크
                </label>
                <input
                  type="url"
                  value={formData.externalLinks?.reservation || ''}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    externalLinks: { ...formData.externalLinks, reservation: e.target.value }
                  })}
                  className="input"
                  placeholder="https://reservation.example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  태그 (수동 입력)
                </label>
                <input
                  type="text"
                  value={formData.sourceTags?.join(', ') || ''}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    sourceTags: e.target.value.split(',').map(tag => tag.trim()).filter(tag => tag !== '')
                  })}
                  className="input"
                  placeholder="예: 데이트, 가족, 힙한"
                />
                <p className="mt-2 text-sm text-gray-500">
                  검색과 추천에 사용됩니다
                </p>
              </div>

              {/* AI 추천 태그 (수정 가능) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  🤖 AI 추천 태그 {autoFillStatus.derivedTags && <span className="text-green-600 text-xs">✅ AI 분석</span>}
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {formData.derivedTags && formData.derivedTags.length > 0 ? (
                    formData.derivedTags.map((tag, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm flex items-center gap-2"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => setFormData({
                            ...formData,
                            derivedTags: formData.derivedTags?.filter((_, i) => i !== index)
                          })}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          ×
                        </button>
                      </span>
                    ))
                  ) : (
                    <p className="text-gray-400 text-sm">AI 자동 채우기를 사용하면 태그가 추천됩니다</p>
                  )}
                </div>
                
                {/* 태그 추가 입력 */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="태그 입력 (예: 데이트, 힙한)"
                    className="input flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const input = e.currentTarget;
                        const newTag = input.value.trim();
                        if (newTag && !formData.derivedTags?.includes(newTag)) {
                          setFormData({
                            ...formData,
                            derivedTags: [...(formData.derivedTags || []), newTag]
                          });
                          input.value = '';
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                      const newTag = input.value.trim();
                      if (newTag && !formData.derivedTags?.includes(newTag)) {
                        setFormData({
                          ...formData,
                          derivedTags: [...(formData.derivedTags || []), newTag]
                        });
                        input.value = '';
                      }
                    }}
                    className="btn btn-secondary whitespace-nowrap"
                  >
                    태그 추가
                  </button>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  AI 추천 태그를 수정하거나 직접 추가할 수 있습니다
                </p>
              </div>

              {/* 운영 시간 (수정 가능) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  🕐 운영 시간 (선택) {autoFillStatus.openingHours && <span className="text-green-600 text-xs">✅ AI 분석</span>}
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">평일</label>
                    <input
                      type="text"
                      value={formData.openingHours?.weekday || ''}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        openingHours: { ...formData.openingHours, weekday: e.target.value } 
                      })}
                      className="input text-sm"
                      placeholder="예: 10:00-18:00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">주말</label>
                    <input
                      type="text"
                      value={formData.openingHours?.weekend || ''}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        openingHours: { ...formData.openingHours, weekend: e.target.value } 
                      })}
                      className="input text-sm"
                      placeholder="예: 10:00-20:00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">공휴일</label>
                    <input
                      type="text"
                      value={formData.openingHours?.holiday || ''}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        openingHours: { ...formData.openingHours, holiday: e.target.value } 
                      })}
                      className="input text-sm"
                      placeholder="예: 10:00-18:00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">휴무일</label>
                    <input
                      type="text"
                      value={formData.openingHours?.closed || ''}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        openingHours: { ...formData.openingHours, closed: e.target.value } 
                      })}
                      className="input text-sm"
                      placeholder="예: 월요일"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">참고사항</label>
                    <input
                      type="text"
                      value={formData.openingHours?.notes || ''}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        openingHours: { ...formData.openingHours, notes: e.target.value } 
                      })}
                      className="input text-sm"
                      placeholder="예: 입장 마감 30분 전"
                    />
                  </div>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  AI 자동 채우기 후 수정 가능합니다
                </p>
              </div>
            </div>
          </section>

          {/* 🆕 카테고리별 특화 필드 */}
          
          {/* 전시 특화 필드 */}
          {formData.mainCategory === '전시' && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🎨 전시 특화 정보</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    작가/아티스트 (쉼표로 구분)
                  </label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.exhibition?.artists?.join(', ') || ''}
                    onChange={(e) => {
                      const artists = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            exhibition: {
                              ...formData.metadata?.display?.exhibition,
                              artists,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="예: 팀랩, 구사마 야요이"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    장르 (쉼표로 구분)
                  </label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.exhibition?.genre?.join(', ') || ''}
                    onChange={(e) => {
                      const genre = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            exhibition: {
                              ...formData.metadata?.display?.exhibition,
                              genre,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="예: 미디어아트, 현대미술"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">전시 유형</label>
                    <select
                      value={formData.metadata?.display?.exhibition?.type || '기획전'}
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          metadata: {
                            ...formData.metadata,
                            display: {
                              ...formData.metadata?.display,
                              exhibition: {
                                ...formData.metadata?.display?.exhibition,
                                type: e.target.value,
                              },
                            },
                          },
                        });
                      }}
                      className="input"
                    >
                      <option value="기획전">기획전</option>
                      <option value="특별전">특별전</option>
                      <option value="상설전">상설전</option>
                      <option value="순회전">순회전</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">권장 관람 시간 (분)</label>
                    <input
                      type="number"
                      value={formData.metadata?.display?.exhibition?.duration_minutes || 60}
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          metadata: {
                            ...formData.metadata,
                            display: {
                              ...formData.metadata?.display,
                              exhibition: {
                                ...formData.metadata?.display?.exhibition,
                                duration_minutes: parseInt(e.target.value) || 60,
                              },
                            },
                          },
                        });
                      }}
                      className="input"
                      placeholder="60"
                    />
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 공연 특화 필드 */}
          {formData.mainCategory === '공연' && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🎭 공연 특화 정보</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    출연진 (쉼표로 구분)
                  </label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.performance?.cast?.join(', ') || ''}
                    onChange={(e) => {
                      const cast = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            performance: {
                              ...formData.metadata?.display?.performance,
                              cast,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="예: 홍길동, 김철수"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    장르 (쉼표로 구분)
                  </label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.performance?.genre?.join(', ') || ''}
                    onChange={(e) => {
                      const genre = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            performance: {
                              ...formData.metadata?.display?.performance,
                              genre,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="예: 뮤지컬, 콘서트"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">공연 시간 (분)</label>
                    <input
                      type="number"
                      value={formData.metadata?.display?.performance?.duration_minutes || 120}
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          metadata: {
                            ...formData.metadata,
                            display: {
                              ...formData.metadata?.display,
                              performance: {
                                ...formData.metadata?.display?.performance,
                                duration_minutes: parseInt(e.target.value) || 120,
                              },
                            },
                          },
                        });
                      }}
                      className="input"
                      placeholder="120"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">연령 제한</label>
                    <input
                      type="text"
                      value={formData.metadata?.display?.performance?.age_limit || ''}
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          metadata: {
                            ...formData.metadata,
                            display: {
                              ...formData.metadata?.display,
                              performance: {
                                ...formData.metadata?.display?.performance,
                                age_limit: e.target.value,
                              },
                            },
                          },
                        });
                      }}
                      className="input"
                      placeholder="예: 만 13세 이상"
                    />
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 축제 특화 필드 */}
          {formData.mainCategory === '축제' && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🎪 축제 특화 정보</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">주최/주관</label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.festival?.organizer || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            festival: {
                              ...formData.metadata?.display?.festival,
                              organizer: e.target.value,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="예: 서울시, 관광공사"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">주요 프로그램</label>
                  <textarea
                    value={formData.metadata?.display?.festival?.program_highlights || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            festival: {
                              ...formData.metadata?.display?.festival,
                              program_highlights: e.target.value,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    rows={3}
                    placeholder="축제의 주요 프로그램을 입력하세요"
                  />
                </div>
              </div>
            </section>
          )}

          {/* 팝업 특화 필드 */}
          {formData.mainCategory === '팝업' && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🏪 팝업 특화 정보</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">팝업 타입</label>
                    <input
                      type="text"
                      value={formData.metadata?.display?.popup?.type || ''}
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          metadata: {
                            ...formData.metadata,
                            display: {
                              ...formData.metadata?.display,
                              popup: {
                                ...formData.metadata?.display?.popup,
                                type: e.target.value,
                              },
                            },
                          },
                        });
                      }}
                      className="input"
                      placeholder="예: F&B, 콜라보, 굿즈"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">브랜드</label>
                    <input
                      type="text"
                      value={formData.metadata?.display?.popup?.brands || ''}
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          metadata: {
                            ...formData.metadata,
                            display: {
                              ...formData.metadata?.display,
                              popup: {
                                ...formData.metadata?.display?.popup,
                                brands: e.target.value,
                              },
                            },
                          },
                        });
                      }}
                      className="input"
                      placeholder="예: 로와이드"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    포토존 여부 및 설명
                  </label>
                  <textarea
                    value={formData.metadata?.display?.popup?.photo_zone || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            popup: {
                              ...formData.metadata?.display?.popup,
                              photo_zone: e.target.value,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    rows={3}
                    placeholder="포토존이 있으면 상세 설명을 입력하세요"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    대기 시간 안내
                  </label>
                  <textarea
                    value={formData.metadata?.display?.popup?.waiting_time || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            popup: {
                              ...formData.metadata?.display?.popup,
                              waiting_time: e.target.value,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    rows={2}
                    placeholder="예: 주말 오후 2-5시 평균 10-15분 대기"
                  />
                </div>
              </div>
            </section>
          )}

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
                      개인 SNS 사진이 아님을 확인합니다.
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
              className="btn btn-primary flex-1"
            >
              {loading ? '생성 중...' : '✅ 이벤트 생성'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={loading}
              className="btn btn-secondary"
            >
              🔄 초기화
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

