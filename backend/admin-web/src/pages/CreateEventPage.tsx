import { useState, type FormEvent, type ChangeEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { adminApi } from '../services/api';
import FieldSelectorModal from '../components/FieldSelectorModal';
import DeployChecklist from '../components/DeployChecklist';

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
  // 주차 정보
  parkingAvailable?: boolean | null;
  parkingInfo?: string | null;
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
  // fieldSources: 각 필드가 어떻게 채워졌는지 추적 ('caption' | 'ai' | 'manual')
  const [fieldSources, setFieldSources] = useState<Record<string, 'caption' | 'ai' | 'manual'>>({});
  // 🆕 필드 선택 기능 (EventsPage와 동일)
  const [showFieldSelectorModal, setShowFieldSelectorModal] = useState(false);
  // 🆕 AI 제안 시스템
  const [aiSuggestions, setAiSuggestions] = useState<any>(null);
  const [captionText, setCaptionText] = useState('');
  const [captionParsing, setCaptionParsing] = useState(false);
  const [captionLockedFields, setCaptionLockedFields] = useState<Set<string>>(new Set());

  // 필드 출처 뱃지 헬퍼
  const getFieldSourceBadge = (fieldKey: string) => {
    const s = fieldSources[fieldKey];
    if (!s) return null;
    const cfg = {
      caption: { label: '캡션', bg: '#DBEAFE', color: '#1D4ED8' },
      ai:      { label: 'AI',   bg: '#FEF9C3', color: '#B45309' },
      manual:  { label: '수동', bg: '#F3E8FF', color: '#7E22CE' },
    };
    const c = cfg[s];
    return <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: c.bg, color: c.color, marginLeft: 6, fontWeight: 700 }}>{c.label}</span>;
  };

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
        // 주차 정보
        parkingAvailable: null,
        parkingInfo: null,
        // 🆕 Phase 3: 카테고리별 특화 필드
        metadata: {},
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
      // 주차 정보
      parkingAvailable: null,
      parkingInfo: null,
      // 🆕 Phase 3: 카테고리별 특화 필드
      metadata: {},
    };
  });

  // 🆕 통합 AI 보완 함수 (EventsPage와 동일 패턴)
  const handleAIEnrichPreview = async (
    forceFields: string[] = [],
    titleHint?: string,           // 캡션 파싱 후 stale closure 우회용
    sourceTagsHint?: string[]     // 캡션 source_tags → AI derived_tags 참고
  ) => {
    const effectiveTitle = titleHint || formData.title;
    if (!effectiveTitle) {
      alert('제목을 먼저 입력하세요!');
      return;
    }

    setAutoFillLoading(true);

    try {
      const result = await adminApi.enrichEventPreview({
        title: effectiveTitle,
        venue: formData.venue || undefined,
        main_category: formData.mainCategory || undefined,
        overview: formData.overview || undefined,
        selectedFields: forceFields.length > 0 && !forceFields.includes('*') ? forceFields : undefined,
        sourceTagsHint: sourceTagsHint || (formData.sourceTags?.length ? formData.sourceTags : undefined),
      });

      if (!result.success) {
        alert(result.message || 'AI 분석에 실패했습니다.');
        return;
      }

      // Phase 2: 제안 시스템
      if (result.suggestions) {
        // forceFields가 비어있거나 '*'이면 빈 필드만 보완
        const isEmptyFieldsOnly = forceFields.length === 0;
        const isForceAll = forceFields.includes('*');

        const enriched: any = {};
        Object.keys(result.suggestions).forEach((fieldName) => {
          const suggestion = result.suggestions[fieldName];
          enriched[fieldName] = suggestion.value;
        });

        // 결과를 폼에 적용
        setFormData((prev) => {
          const shouldUpdate = (fieldKey: string, currentValue: any) => {
            // 캡션으로 확정된 필드는 절대 덮어쓰지 않음
            if (captionLockedFields.has(fieldKey)) return false;
            if (isForceAll) return true;
            if (isEmptyFieldsOnly) {
              if (Array.isArray(currentValue)) return currentValue.length === 0;
              if (typeof currentValue === 'object' && currentValue !== null) return Object.keys(currentValue).length === 0;
              return !currentValue || currentValue === '' || currentValue === null;
            }
            return forceFields.includes(fieldKey);
          };

          // 🆕 metadata 필드 처리
          const updatedMetadata: any = { ...prev.metadata };
          Object.keys(enriched).forEach((key) => {
            if (key.startsWith('metadata.display.')) {
              const parts = key.split('.');
              if (parts.length >= 4) {
                const category = parts[2]; // exhibition, performance, popup, etc.
                const field = parts.slice(3).join('.'); // 나머지 경로

                if (shouldUpdate(key, (prev.metadata?.display as any)?.[category]?.[field])) {
                  if (!updatedMetadata.display) updatedMetadata.display = {};
                  if (!updatedMetadata.display[category]) updatedMetadata.display[category] = {};

                  // 중첩된 필드 처리 (예: fnb_items.signature_menu)
                  if (field.includes('.')) {
                    const fieldParts = field.split('.');
                    let current = updatedMetadata.display[category];
                    for (let i = 0; i < fieldParts.length - 1; i++) {
                      if (!current[fieldParts[i]]) current[fieldParts[i]] = {};
                      current = current[fieldParts[i]];
                    }
                    current[fieldParts[fieldParts.length - 1]] = enriched[key];
                  } else {
                    updatedMetadata.display[category][field] = enriched[key];
                  }
                }
              }
            }
          });

          const next = {
            ...prev,
            startAt: shouldUpdate('start_at', prev.startAt) && enriched.start_at ? enriched.start_at : prev.startAt,
            endAt: shouldUpdate('end_at', prev.endAt) && enriched.end_at ? enriched.end_at : prev.endAt,
            venue: shouldUpdate('venue', prev.venue) && enriched.venue ? enriched.venue : prev.venue,
            address: shouldUpdate('address', prev.address) && enriched.address ? enriched.address : prev.address,
            overview: shouldUpdate('overview', prev.overview) && enriched.overview ? enriched.overview : prev.overview,
            lat: shouldUpdate('lat', prev.lat) && enriched.lat ? enriched.lat : prev.lat,
            lng: shouldUpdate('lng', prev.lng) && enriched.lng ? enriched.lng : prev.lng,
            region: shouldUpdate('region', prev.region) && enriched.region ? enriched.region : prev.region,
            derivedTags: shouldUpdate('derived_tags', prev.derivedTags) && enriched.derived_tags ? enriched.derived_tags : prev.derivedTags,
            openingHours: shouldUpdate('opening_hours', prev.openingHours) && enriched.opening_hours ? enriched.opening_hours : prev.openingHours,
            priceMin: shouldUpdate('price_min', prev.priceMin) && enriched.price_min != null ? enriched.price_min : prev.priceMin,
            priceMax: shouldUpdate('price_max', prev.priceMax) && enriched.price_max != null ? enriched.price_max : prev.priceMax,
            parkingAvailable: shouldUpdate('parking_available', prev.parkingAvailable) && enriched.parking_available != null ? enriched.parking_available : prev.parkingAvailable,
            parkingInfo: shouldUpdate('parking_info', prev.parkingInfo) && enriched.parking_info ? enriched.parking_info : prev.parkingInfo,
            externalLinks: {
              official: (shouldUpdate('external_links.official', prev.externalLinks?.official) && enriched['external_links.official']) || prev.externalLinks?.official || '',
              ticket: (shouldUpdate('external_links.ticket', prev.externalLinks?.ticket) && enriched['external_links.ticket']) || prev.externalLinks?.ticket || '',
              reservation: (shouldUpdate('external_links.reservation', prev.externalLinks?.reservation) && enriched['external_links.reservation']) || prev.externalLinks?.reservation || '',
            },
            // 🆕 metadata 적용
            metadata: Object.keys(updatedMetadata).length > 0 ? updatedMetadata : prev.metadata,
          };
          // AI로 변경된 필드 추적 (실제로 변경된 필드만 카운트)
          const aiKeys: string[] = [];
          if (next.startAt !== prev.startAt) aiKeys.push('start_at');
          if (next.endAt !== prev.endAt) aiKeys.push('end_at');
          if (next.venue !== prev.venue) aiKeys.push('venue');
          if (next.address !== prev.address) aiKeys.push('address');
          if (next.overview !== prev.overview) aiKeys.push('overview');
          if (next.derivedTags !== prev.derivedTags) aiKeys.push('derived_tags');
          if (next.openingHours !== prev.openingHours) aiKeys.push('opening_hours');
          if (next.priceMin !== prev.priceMin) aiKeys.push('price_min');
          if (next.priceMax !== prev.priceMax) aiKeys.push('price_max');
          if (next.parkingAvailable !== prev.parkingAvailable) aiKeys.push('parking_available');
          if (next.parkingInfo !== prev.parkingInfo) aiKeys.push('parking_info');
          if (aiKeys.length > 0) {
            // setFieldSources는 상태 업데이트라 여기서 직접 호출 불가 → setTimeout으로 처리
            setTimeout(() => {
              setFieldSources((ps) => {
                const updated = { ...ps };
                aiKeys.forEach((k) => { if (!ps[k] || ps[k] === 'ai') updated[k] = 'ai'; });
                return updated;
              });
            }, 0);
          }
          return next;
        });

        const modeLabel = isForceAll ? '전체 재생성' : isEmptyFieldsOnly ? '빈 필드 보완' : '선택 필드 재생성';
        // result.suggestions 개수가 아니라 실제 API가 값을 찾아온 필드 수 (null 제외)
        const foundCount = Object.keys(result.suggestions).filter(k => {
          if (captionLockedFields.has(k)) return false;
          return result.suggestions[k]?.value != null;
        }).length;
        const msg = foundCount > 0
          ? `✅ ${modeLabel} 완료!\n\n채워진 필드: ${foundCount}개`
          : `ℹ️ AI가 정보를 찾지 못했습니다.\n\n검색 결과가 없거나 아직 공개되지 않은 이벤트일 수 있어요.\n캡션 파싱이나 직접 입력을 이용해 주세요.`;
        alert(msg);
        return;
      }

      alert('AI 제안을 생성하지 못했습니다.');
    } catch (error: any) {
      console.error('[AI Enrich Preview] Error:', error);
      alert('AI 분석 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
    } finally {
      setAutoFillLoading(false);
    }
  };

  const handleCaptionParse = async () => {
    if (!captionText.trim()) {
      alert('캡션을 입력하세요.');
      return;
    }
    setCaptionParsing(true);
    try {
      const result = await adminApi.captionParse(captionText);
      if (!result.success || !result.fields) {
        alert(result.message || '캡션 파싱에 실패했습니다.');
        return;
      }
      const f = result.fields;

      // ✅ locked set을 setFormData 호출 전에 미리 구성 (alert 시점에 size가 정확해야 함)
      const locked = new Set<string>();
      if (f.title) locked.add('title');
      if (f.start_date) locked.add('start_at');
      if (f.end_date) locked.add('end_at');
      if (f.venue) locked.add('venue');
      if (f.address) locked.add('address');
      if (f.opening_hours) locked.add('opening_hours');
      if (f.is_free !== undefined) locked.add('is_free');
      if (f.price_info) locked.add('price_info');
      if (f.price_min !== undefined) locked.add('price_min');
      if (f.price_max !== undefined) locked.add('price_max');
      if (f.instagram_url) locked.add('instagram_url');
      if (f.source_tags && f.source_tags.length > 0) locked.add('source_tags');
      if (f.popup_brand) locked.add('popup_brand');
      if (f.popup_type) locked.add('popup_type');
      if (f.is_fnb !== undefined) locked.add('is_fnb');
      if (f.has_photo_zone !== undefined) locked.add('has_photo_zone');
      if (f.goods_items && f.goods_items.length > 0) locked.add('goods_items');
      if (f.signature_menu && f.signature_menu.length > 0) locked.add('signature_menu');

      // 캡션 출처 마킹
      setFieldSources((prev) => {
        const next = { ...prev };
        locked.forEach((k) => { next[k] = 'caption'; });
        return next;
      });

      setFormData((prev) => {
        const next = { ...prev };
        if (f.title) next.title = f.title;
        if (f.start_date) next.startAt = f.start_date;
        if (f.end_date) next.endAt = f.end_date;
        if (f.venue) next.venue = f.venue;
        if (f.address) next.address = f.address;
        if (f.opening_hours) next.openingHours = f.opening_hours;
        if (f.is_free !== undefined) next.isFree = f.is_free;
        if (f.price_info) next.priceInfo = f.price_info;
        if (f.price_min !== undefined) next.priceMin = f.price_min;
        if (f.price_max !== undefined) next.priceMax = f.price_max;
        if (f.instagram_url) {
          next.instagramUrl = f.instagram_url;
          next.externalLinks = { ...next.externalLinks, instagram: f.instagram_url };
        }
        if (f.source_tags && f.source_tags.length > 0) next.sourceTags = f.source_tags;
        // 팝업 전용 메타데이터
        const popupMeta: any = {};
        if (f.popup_brand) popupMeta.brand = f.popup_brand;
        if (f.popup_type) popupMeta.type = f.popup_type;
        if (f.is_fnb !== undefined) popupMeta.is_fnb = f.is_fnb;
        if (f.has_photo_zone !== undefined) popupMeta.has_photo_zone = f.has_photo_zone;
        if (f.goods_items && f.goods_items.length > 0) popupMeta.goods = f.goods_items;
        if (f.signature_menu && f.signature_menu.length > 0) popupMeta.best_items = f.signature_menu;
        if (Object.keys(popupMeta).length > 0) {
          next.metadata = {
            ...next.metadata,
            display: { ...next.metadata?.display, popup: { ...(next.metadata?.display?.popup || {}), ...popupMeta } },
          };
        }
        return next;
      });

      setCaptionLockedFields(locked);

      // 캡션 파싱 후 AI 보완 자동 실행 (캡션에 없는 빈 필드만)
      // titleHint로 stale closure 우회, sourceTagsHint로 AI derived_tags 참고
      const captionTitle = f.title || undefined;
      const captionSourceTags = f.source_tags || [];
      setTimeout(() => {
        handleAIEnrichPreview([], captionTitle, captionSourceTags.length ? captionSourceTags : undefined);
      }, 300);

      alert(`✅ 캡션 파싱 완료! ${locked.size}개 필드 자동채우기 완료.\nAI 보완으로 나머지 필드를 채웁니다.`);
    } catch (error: any) {
      alert('캡션 파싱 오류: ' + (error.message || '알 수 없는 오류'));
    } finally {
      setCaptionParsing(false);
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
          if (!tags || !Array.isArray(tags)) return null;
          const cleaned = tags.filter(tag => tag && typeof tag === 'string' && tag.trim() !== '');
          return cleaned.length > 0 ? cleaned : null;
        };

        // 데이터 정리
        // Instagram URL을 external_links에 추가 (팝업 전용 필드 → 공통 필드로 복사)
        const externalLinksWithInstagram = {
          ...formData.externalLinks,
          instagram: formData.instagramUrl || formData.externalLinks?.instagram
        };
        const cleanedExternalLinks = cleanExternalLinks(externalLinksWithInstagram);
        const cleanedOpeningHours = cleanOpeningHours(formData.openingHours);
        const cleanedSourceTags = cleanTags(formData.sourceTags);
        const cleanedDerivedTags = cleanTags(formData.derivedTags);

        // 🔍 디버깅: 전송 데이터 확인
        console.log('[CreatePopup] Sending data:', {
          external_links: cleanedExternalLinks,
          opening_hours: cleanedOpeningHours,
          source_tags: cleanedSourceTags,
          derived_tags: cleanedDerivedTags,
          parking_available: formData.parkingAvailable,
          parking_info: formData.parkingInfo,
          metadata: formData.metadata,
        });

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
          // Phase 1 공통 필드 (빈 문자열/배열 제거)
          is_free: formData.isFree,
          price_info: formData.priceInfo || null,
          external_links: cleanedExternalLinks,
          price_min: formData.priceMin ?? null,
          price_max: formData.priceMax ?? null,
          source_tags: cleanedSourceTags || undefined,
          derived_tags: cleanedDerivedTags || undefined,
          opening_hours: cleanedOpeningHours,
          parking_available: formData.parkingAvailable ?? null,
          parking_info: formData.parkingInfo || null,
          // 🆕 Phase 3: 카테고리별 특화 필드
          metadata: formData.metadata,
        } as any);
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

        // 데이터 정리
        const cleanedExternalLinks = cleanExternalLinks(formData.externalLinks);
        const cleanedOpeningHours = cleanOpeningHours(formData.openingHours);
        const cleanedSourceTags = cleanTags(formData.sourceTags);
        const cleanedDerivedTags = cleanTags(formData.derivedTags);

        // 🔍 디버깅: 전송 데이터 확인
        console.log('[CreateEvent] Sending data:', {
          external_links: cleanedExternalLinks,
          opening_hours: cleanedOpeningHours,
          source_tags: cleanedSourceTags,
          derived_tags: cleanedDerivedTags,
          parking_available: formData.parkingAvailable,
          parking_info: formData.parkingInfo,
          metadata: formData.metadata,
        });

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
          external_links: cleanedExternalLinks,
          price_min: formData.priceMin ?? null,
          price_max: formData.priceMax ?? null,
          source_tags: cleanedSourceTags || undefined,
          derived_tags: cleanedDerivedTags || undefined,
          opening_hours: cleanedOpeningHours,
          // 주차 정보
          parking_available: formData.parkingAvailable ?? null,
          parking_info: formData.parkingInfo || null,
          // 🆕 Phase 3: 카테고리별 특화 필드
          metadata: formData.metadata,
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
      // 주차 정보
      parkingAvailable: null,
      parkingInfo: null,
      // 🆕 Phase 3: 카테고리별 특화 필드
      metadata: {},
    });
    setAgreedCopyright(false);
    setFieldSources({});
    setCaptionLockedFields(new Set());
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

          {/* 캡션 자동채우기 — 팝업 전용 */}
          {formData.mainCategory === '팝업' && (
            <div style={{
              background: '#EFF6FF',
              border: '1px solid #BFDBFE',
              borderRadius: 12,
              padding: '16px 20px',
              marginBottom: 24,
            }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#1D4ED8', marginBottom: 8 }}>
                📋 캡션으로 자동채우기
              </div>
              <div style={{ fontSize: 12, color: '#3B82F6', marginBottom: 12 }}>
                팝가, 인스타그램 등에서 복사한 캡션을 붙여넣으면 AI가 필드를 자동으로 채워드려요.
              </div>
              <textarea
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                placeholder="캡션을 여기에 붙여넣으세요..."
                rows={6}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #BFDBFE',
                  borderRadius: 8,
                  fontSize: 13,
                  lineHeight: 1.6,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                  background: '#fff',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={handleCaptionParse}
                  disabled={captionParsing || !captionText.trim()}
                  style={{
                    background: captionParsing || !captionText.trim() ? '#93C5FD' : '#2563EB',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 18px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: captionParsing || !captionText.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {captionParsing ? '⏳ 파싱 중...' : '🔍 캡션으로 자동채우기'}
                </button>
                {captionLockedFields.size > 0 && (
                  <span style={{ fontSize: 12, color: '#16A34A', fontWeight: 600 }}>
                    ✅ {captionLockedFields.size}개 필드 확정됨
                  </span>
                )}
              </div>
              {captionLockedFields.size > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, color: '#6B7280' }}>
                  🔒 확정 필드는 AI 보완이 덮어쓰지 않아요: {Array.from(captionLockedFields).join(', ')}
                </div>
              )}
            </div>
          )}

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
                
                {/* 3개 버튼 (EventsPage와 동일) */}
                <div className="flex gap-2 flex-wrap w-full">
                  <button
                    type="button"
                    onClick={() => handleAIEnrichPreview([])}
                    disabled={!formData.title || autoFillLoading}
                    className="btn btn-secondary text-sm flex items-center gap-2"
                  >
                    {autoFillLoading ? '🔄 분석 중...' : '🤖 추천 보완 (네이버+AI)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFieldSelectorModal(true)}
                    disabled={!formData.title}
                    className="btn btn-outline text-sm flex items-center gap-2"
                  >
                    🎯 선택 필드 재생성
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('⚠️ 경고: 모든 필드를 강제로 재생성합니다.\n수동으로 입력한 데이터도 덮어씌워집니다.\n\n계속하시겠습니까?')) {
                        handleAIEnrichPreview(['*']);
                      }
                    }}
                    disabled={!formData.title || autoFillLoading}
                    className="btn btn-danger text-sm flex items-center gap-2"
                  >
                    🚨 전체 재생성
                  </button>
                </div>

                {/* 🆕 AI 제안 섹션 */}
                {aiSuggestions && Object.keys(aiSuggestions).length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-blue-900">💡 AI 제안 ({Object.keys(aiSuggestions).length}개)</h4>
                      <button
                        type="button"
                        onClick={() => setAiSuggestions(null)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        모두 닫기
                      </button>
                    </div>
                    
                    {Object.entries(aiSuggestions).map(([fieldName, suggestion]: [string, any]) => (
                      <div key={fieldName} className="bg-white border border-gray-200 rounded p-3 space-y-2">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-700">{fieldName}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              출처: {suggestion.source} ({suggestion.confidence}% 신뢰도)
                            </p>
                          </div>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            suggestion.confidence >= 80
                              ? 'bg-green-100 text-green-700'
                              : suggestion.confidence >= 60
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {suggestion.confidence >= 80 ? '높음' : suggestion.confidence >= 60 ? '중간' : '낮음'}
                          </span>
                        </div>
                        
                        <div className="bg-gray-50 p-2 rounded text-sm">
                          <pre className="whitespace-pre-wrap font-mono text-xs">
                            {typeof suggestion.value === 'object' 
                              ? JSON.stringify(suggestion.value, null, 2) 
                              : String(suggestion.value)}
                          </pre>
                        </div>
                        
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              // Apply suggestion
                              const value = suggestion.value;
                              setFormData((prev) => {
                                const updated = { ...prev };
                                
                                if (fieldName === 'start_at') updated.startAt = value;
                                else if (fieldName === 'end_at') updated.endAt = value;
                                else if (fieldName === 'venue') updated.venue = value;
                                else if (fieldName === 'address') updated.address = value;
                                else if (fieldName === 'overview') updated.overview = value;
                                else if (fieldName === 'derived_tags') updated.derivedTags = value;
                                else if (fieldName === 'opening_hours') updated.openingHours = value;
                                else if (fieldName === 'price_min') updated.priceMin = value;
                                else if (fieldName === 'price_max') updated.priceMax = value;
                                else if (fieldName.startsWith('external_links.')) {
                                  const linkType = fieldName.split('.')[1];
                                  updated.externalLinks = {
                                    ...updated.externalLinks,
                                    [linkType]: value,
                                  };
                                }
                                else if (fieldName.startsWith('metadata.display.')) {
                                  const parts = fieldName.split('.');
                                  const category = parts[2];
                                  const field = parts[3];
                                  
                                  if (!updated.metadata) updated.metadata = { display: {} };
                                  if (!updated.metadata.display) updated.metadata.display = {};
                                  if (!updated.metadata.display[category as 'exhibition' | 'performance' | 'festival' | 'event' | 'popup']) {
                                    (updated.metadata.display as any)[category] = {};
                                  }
                                  (updated.metadata.display as any)[category][field] = value;
                                }

                                return updated;
                              });

                              // Remove from suggestions
                              setAiSuggestions((prev: any) => {
                                if (!prev) return prev;
                                const newSuggestions = { ...prev };
                                delete newSuggestions[fieldName];
                                return Object.keys(newSuggestions).length > 0 ? newSuggestions : null;
                              });
                            }}
                            className="btn btn-sm btn-primary"
                          >
                            ✅ 적용
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAiSuggestions((prev: any) => {
                                if (!prev) return prev;
                                const newSuggestions = { ...prev };
                                delete newSuggestions[fieldName];
                                return Object.keys(newSuggestions).length > 0 ? newSuggestions : null;
                              });
                            }}
                            className="btn btn-sm btn-outline"
                          >
                            ❌ 거부
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-xs text-gray-600 w-full">
                  💡 <strong>빈 필드만 AI 보완:</strong> 네이버 검색 + AI로 기본 정보 자동 채우기<br/>
                  💡 <strong>선택한 필드만 재생성:</strong> 특정 필드만 골라서 AI 재생성 (선택 후 사용)<br/>
                  💡 <strong>강제 재생성:</strong> 모든 필드를 AI로 덮어쓰기<br/>
                  💡 <strong>AI만으로 빈 필드 보완:</strong> 네이버 없이 AI 직접 검색 (포토존, 대기시간 등 상세 정보)
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  제목 * {getFieldSourceBadge('title')}
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => { setFormData({ ...formData, title: e.target.value }); setFieldSources((p) => ({ ...p, title: 'manual' })); }}
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
                  시작일 * {getFieldSourceBadge('start_at')}
                </label>
                <input
                  type="date"
                  value={formData.startAt}
                  onChange={(e) => { setFormData({ ...formData, startAt: e.target.value }); setFieldSources((p) => ({ ...p, start_at: 'manual' })); }}
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  종료일 * {getFieldSourceBadge('end_at')}
                </label>
                <input
                  type="date"
                  value={formData.endAt}
                  onChange={(e) => { setFormData({ ...formData, endAt: e.target.value }); setFieldSources((p) => ({ ...p, end_at: 'manual' })); }}
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
                  장소 * {getFieldSourceBadge('venue')}
                </label>
                <input
                  type="text"
                  value={formData.venue}
                  onChange={(e) => { setFormData({ ...formData, venue: e.target.value }); setFieldSources((p) => ({ ...p, venue: 'manual' })); }}
                  className="input"
                  placeholder="예: 롯데월드몰"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  주소 (선택) {getFieldSourceBadge('address')}
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => { setFormData({ ...formData, address: e.target.value }); setFieldSources((p) => ({ ...p, address: 'manual' })); }}
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
                개요 (선택) {getFieldSourceBadge('overview')}
              </label>
              <textarea
                value={formData.overview}
                onChange={(e) => { setFormData({ ...formData, overview: e.target.value }); setFieldSources((p) => ({ ...p, overview: 'manual' })); }}
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
              {getFieldSourceBadge('external_links.official')}
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
                  🤖 AI 추천 태그 {getFieldSourceBadge('derived_tags')}
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
                  🕐 운영 시간 (선택) {getFieldSourceBadge('opening_hours')}
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

              {/* 주차 정보 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  🚗 주차 정보 (선택)
                </label>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">주차 가능 여부</label>
                    <select
                      value={
                        formData.parkingAvailable === null || formData.parkingAvailable === undefined
                          ? 'null'
                          : formData.parkingAvailable
                          ? 'true'
                          : 'false'
                      }
                      onChange={(e) => {
                        const value = e.target.value === 'null' ? null : e.target.value === 'true';
                        setFormData({ ...formData, parkingAvailable: value });
                      }}
                      className="input text-sm"
                    >
                      <option value="null">정보 없음</option>
                      <option value="true">가능</option>
                      <option value="false">불가능</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">주차 상세 정보</label>
                    <textarea
                      value={formData.parkingInfo || ''}
                      onChange={(e) => setFormData({ ...formData, parkingInfo: e.target.value })}
                      className="input text-sm"
                      rows={2}
                      placeholder="예: 건물 지하 주차장 이용 가능, 1시간 무료"
                    />
                  </div>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  AI가 분석한 주차 정보를 수동으로 수정할 수 있습니다
                </p>
              </div>
            </div>
          </section>

          {/* 🆕 카테고리별 특화 필드 (EventsPage.tsx와 동일) */}
          
          {/* 전시 특화 필드 */}
          {formData.mainCategory === '전시' && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🎨 전시 특화 정보</h3>
              <div className="space-y-4">
                {/* 작가/아티스트 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
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
                              artists,
                              genre: formData.metadata?.display?.exhibition?.genre || [],
                              type: formData.metadata?.display?.exhibition?.type || '기획전',
                              duration_minutes: formData.metadata?.display?.exhibition?.duration_minutes || 60,
                              facilities: formData.metadata?.display?.exhibition?.facilities || {
                                photo_zone: false,
                                audio_guide: false,
                                goods_shop: false,
                                cafe: false,
                              },
                              docent_tour: formData.metadata?.display?.exhibition?.docent_tour || null,
                              special_programs: formData.metadata?.display?.exhibition?.special_programs || [],
                              age_recommendation: formData.metadata?.display?.exhibition?.age_recommendation || null,
                              photography_allowed: formData.metadata?.display?.exhibition?.photography_allowed || null,
                              last_admission: formData.metadata?.display?.exhibition?.last_admission || null,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="예: 팀랩, 구사마 야요이"
                  />
                </div>

                {/* 장르 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
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
                              artists: formData.metadata?.display?.exhibition?.artists || [],
                              genre,
                              type: formData.metadata?.display?.exhibition?.type || '기획전',
                              duration_minutes: formData.metadata?.display?.exhibition?.duration_minutes || 60,
                              facilities: formData.metadata?.display?.exhibition?.facilities || {
                                photo_zone: false,
                                audio_guide: false,
                                goods_shop: false,
                                cafe: false,
                              },
                              docent_tour: formData.metadata?.display?.exhibition?.docent_tour || null,
                              special_programs: formData.metadata?.display?.exhibition?.special_programs || [],
                              age_recommendation: formData.metadata?.display?.exhibition?.age_recommendation || null,
                              photography_allowed: formData.metadata?.display?.exhibition?.photography_allowed || null,
                              last_admission: formData.metadata?.display?.exhibition?.last_admission || null,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="예: 미디어아트, 현대미술"
                  />
                </div>

                {/* 전시 유형 + 권장 관람 시간 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      전시 유형
                    </label>
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
                                artists: formData.metadata?.display?.exhibition?.artists || [],
                                genre: formData.metadata?.display?.exhibition?.genre || [],
                                type: e.target.value,
                                duration_minutes: formData.metadata?.display?.exhibition?.duration_minutes || 60,
                                facilities: formData.metadata?.display?.exhibition?.facilities || {
                                  photo_zone: false,
                                  audio_guide: false,
                                  goods_shop: false,
                                  cafe: false,
                                },
                                docent_tour: formData.metadata?.display?.exhibition?.docent_tour || null,
                                special_programs: formData.metadata?.display?.exhibition?.special_programs || [],
                                age_recommendation: formData.metadata?.display?.exhibition?.age_recommendation || null,
                                photography_allowed: formData.metadata?.display?.exhibition?.photography_allowed || null,
                                last_admission: formData.metadata?.display?.exhibition?.last_admission || null,
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      권장 관람 시간 (분)
                    </label>
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
                                artists: formData.metadata?.display?.exhibition?.artists || [],
                                genre: formData.metadata?.display?.exhibition?.genre || [],
                                type: formData.metadata?.display?.exhibition?.type || '기획전',
                                duration_minutes: parseInt(e.target.value) || null,
                                facilities: formData.metadata?.display?.exhibition?.facilities || {
                                  photo_zone: false,
                                  audio_guide: false,
                                  goods_shop: false,
                                  cafe: false,
                                },
                                docent_tour: formData.metadata?.display?.exhibition?.docent_tour || null,
                                special_programs: formData.metadata?.display?.exhibition?.special_programs || [],
                                age_recommendation: formData.metadata?.display?.exhibition?.age_recommendation || null,
                                photography_allowed: formData.metadata?.display?.exhibition?.photography_allowed || null,
                                last_admission: formData.metadata?.display?.exhibition?.last_admission || null,
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

                {/* 편의시설 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">편의시설</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'photo_zone', label: '📸 포토존' },
                      { id: 'audio_guide', label: '🎧 오디오 가이드' },
                      { id: 'goods_shop', label: '🛍️ 굿즈샵' },
                      { id: 'cafe', label: '☕ 카페' },
                    ].map((facility) => (
                      <label key={facility.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={formData.metadata?.display?.exhibition?.facilities?.[facility.id as 'photo_zone' | 'audio_guide' | 'goods_shop' | 'cafe'] || false}
                          onChange={(e) => {
                            setFormData({
                              ...formData,
                              metadata: {
                                ...formData.metadata,
                                display: {
                                  ...formData.metadata?.display,
                                  exhibition: {
                                    artists: formData.metadata?.display?.exhibition?.artists || [],
                                    genre: formData.metadata?.display?.exhibition?.genre || [],
                                    type: formData.metadata?.display?.exhibition?.type || '기획전',
                                    duration_minutes: formData.metadata?.display?.exhibition?.duration_minutes || 60,
                                    facilities: {
                                      ...formData.metadata?.display?.exhibition?.facilities,
                                      [facility.id]: e.target.checked,
                                    },
                                    docent_tour: formData.metadata?.display?.exhibition?.docent_tour || null,
                                    special_programs: formData.metadata?.display?.exhibition?.special_programs || [],
                                    age_recommendation: formData.metadata?.display?.exhibition?.age_recommendation || null,
                                    photography_allowed: formData.metadata?.display?.exhibition?.photography_allowed || null,
                                    last_admission: formData.metadata?.display?.exhibition?.last_admission || null,
                                  },
                                },
                              },
                            });
                          }}
                          className="rounded"
                        />
                        <span>{facility.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 도슨트 투어 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">도슨트 투어</label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.exhibition?.docent_tour || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            exhibition: {
                              artists: formData.metadata?.display?.exhibition?.artists || [],
                              genre: formData.metadata?.display?.exhibition?.genre || [],
                              type: formData.metadata?.display?.exhibition?.type || '기획전',
                              duration_minutes: formData.metadata?.display?.exhibition?.duration_minutes || 60,
                              facilities: formData.metadata?.display?.exhibition?.facilities || {
                                photo_zone: false,
                                audio_guide: false,
                                goods_shop: false,
                                cafe: false,
                              },
                              docent_tour: e.target.value || null,
                              special_programs: formData.metadata?.display?.exhibition?.special_programs || [],
                              age_recommendation: formData.metadata?.display?.exhibition?.age_recommendation || null,
                              photography_allowed: formData.metadata?.display?.exhibition?.photography_allowed || null,
                              last_admission: formData.metadata?.display?.exhibition?.last_admission || null,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="예: 매일 14:00, 16:00"
                  />
                </div>
              </div>
            </section>
          )}

          {/* 공연 특화 필드 */}
          {formData.mainCategory === '공연' && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🎭 공연 특화 정보</h3>
              <div className="space-y-4">
                {/* 출연진 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
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
                              cast,
                              genre: formData.metadata?.display?.performance?.genre || [],
                              duration_minutes: formData.metadata?.display?.performance?.duration_minutes || null,
                              intermission: formData.metadata?.display?.performance?.intermission || false,
                              age_limit: formData.metadata?.display?.performance?.age_limit || '전체관람가',
                              showtimes: formData.metadata?.display?.performance?.showtimes || {},
                              runtime: formData.metadata?.display?.performance?.runtime || null,
                              crew: formData.metadata?.display?.performance?.crew || {
                                director: null,
                                writer: null,
                                composer: null,
                              },
                              discounts: formData.metadata?.display?.performance?.discounts || [],
                              last_admission: formData.metadata?.display?.performance?.last_admission || null,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="예: 조승우, 홍광호"
                  />
                </div>

                {/* 장르 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
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
                              cast: formData.metadata?.display?.performance?.cast || [],
                              genre,
                              duration_minutes: formData.metadata?.display?.performance?.duration_minutes || null,
                              intermission: formData.metadata?.display?.performance?.intermission || false,
                              age_limit: formData.metadata?.display?.performance?.age_limit || '전체관람가',
                              showtimes: formData.metadata?.display?.performance?.showtimes || {},
                              runtime: formData.metadata?.display?.performance?.runtime || null,
                              crew: formData.metadata?.display?.performance?.crew || {
                                director: null,
                                writer: null,
                                composer: null,
                              },
                              discounts: formData.metadata?.display?.performance?.discounts || [],
                              last_admission: formData.metadata?.display?.performance?.last_admission || null,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="예: 뮤지컬, 창작"
                  />
                </div>

                {/* 공연 시간 + 인터미션 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      공연 시간 (분)
                    </label>
                    <input
                      type="number"
                      value={formData.metadata?.display?.performance?.duration_minutes || ''}
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          metadata: {
                            ...formData.metadata,
                            display: {
                              ...formData.metadata?.display,
                              performance: {
                                cast: formData.metadata?.display?.performance?.cast || [],
                                genre: formData.metadata?.display?.performance?.genre || [],
                                duration_minutes: parseInt(e.target.value) || null,
                                intermission: formData.metadata?.display?.performance?.intermission || false,
                                age_limit: formData.metadata?.display?.performance?.age_limit || '전체관람가',
                                showtimes: formData.metadata?.display?.performance?.showtimes || {},
                                runtime: formData.metadata?.display?.performance?.runtime || null,
                                crew: formData.metadata?.display?.performance?.crew || {
                                  director: null,
                                  writer: null,
                                  composer: null,
                                },
                                discounts: formData.metadata?.display?.performance?.discounts || [],
                                last_admission: formData.metadata?.display?.performance?.last_admission || null,
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">인터미션</label>
                    <label className="flex items-center gap-2 mt-2">
                      <input
                        type="checkbox"
                        checked={formData.metadata?.display?.performance?.intermission || false}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            metadata: {
                              ...formData.metadata,
                              display: {
                                ...formData.metadata?.display,
                                performance: {
                                  cast: formData.metadata?.display?.performance?.cast || [],
                                  genre: formData.metadata?.display?.performance?.genre || [],
                                  duration_minutes: formData.metadata?.display?.performance?.duration_minutes || null,
                                  intermission: e.target.checked,
                                  age_limit: formData.metadata?.display?.performance?.age_limit || '전체관람가',
                                  showtimes: formData.metadata?.display?.performance?.showtimes || {},
                                  runtime: formData.metadata?.display?.performance?.runtime || null,
                                  crew: formData.metadata?.display?.performance?.crew || {
                                    director: null,
                                    writer: null,
                                    composer: null,
                                  },
                                  discounts: formData.metadata?.display?.performance?.discounts || [],
                                  last_admission: formData.metadata?.display?.performance?.last_admission || null,
                                },
                              },
                            },
                          });
                        }}
                        className="rounded"
                      />
                      <span className="text-sm">중간 휴식 있음</span>
                    </label>
                  </div>
                </div>

                {/* 연령 제한 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    연령 제한
                  </label>
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
                              cast: formData.metadata?.display?.performance?.cast || [],
                              genre: formData.metadata?.display?.performance?.genre || [],
                              duration_minutes: formData.metadata?.display?.performance?.duration_minutes || null,
                              intermission: formData.metadata?.display?.performance?.intermission || false,
                              age_limit: e.target.value || '전체관람가',
                              showtimes: formData.metadata?.display?.performance?.showtimes || {},
                              runtime: formData.metadata?.display?.performance?.runtime || null,
                              crew: formData.metadata?.display?.performance?.crew || {
                                director: null,
                                writer: null,
                                composer: null,
                              },
                              discounts: formData.metadata?.display?.performance?.discounts || [],
                              last_admission: formData.metadata?.display?.performance?.last_admission || null,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="예: 만 7세 이상, 전체관람가"
                  />
                </div>

                {/* 할인 정보 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    할인 정보 (쉼표로 구분)
                  </label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.performance?.discounts?.join(', ') || ''}
                    onChange={(e) => {
                      const discounts = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            performance: {
                              cast: formData.metadata?.display?.performance?.cast || [],
                              genre: formData.metadata?.display?.performance?.genre || [],
                              duration_minutes: formData.metadata?.display?.performance?.duration_minutes || null,
                              intermission: formData.metadata?.display?.performance?.intermission || false,
                              age_limit: formData.metadata?.display?.performance?.age_limit || '전체관람가',
                              showtimes: formData.metadata?.display?.performance?.showtimes || {},
                              runtime: formData.metadata?.display?.performance?.runtime || null,
                              crew: formData.metadata?.display?.performance?.crew || {
                                director: null,
                                writer: null,
                                composer: null,
                              },
                              discounts,
                              last_admission: formData.metadata?.display?.performance?.last_admission || null,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="예: 조기예매 20%, 청소년 30%"
                  />
                </div>
              </div>
            </section>
          )}

          {/* 축제 특화 필드 */}
          {formData.mainCategory === '축제' && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🎪 축제 특화 정보</h3>
              <div className="space-y-4">
                {/* 주최/주관 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    주최/주관 기관
                  </label>
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
                    placeholder="서울시 관광재단, 문화체육관광부"
                  />
                </div>

                {/* 주요 프로그램 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    주요 프로그램
                  </label>
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
                    rows={3}
                    className="input"
                    placeholder="개막식 불꽃놀이, K-POP 공연, LED 등불 전시"
                  />
                </div>

                {/* 먹거리/체험 부스 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    먹거리/체험 부스
                  </label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.festival?.food_and_booths || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            festival: {
                              ...formData.metadata?.display?.festival,
                              food_and_booths: e.target.value,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="푸드트럭 20개, 체험 부스 10개"
                  />
                </div>

                {/* 규모 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    규모
                  </label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.festival?.scale_text || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            festival: {
                              ...formData.metadata?.display?.festival,
                              scale_text: e.target.value,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="작년 50만 명 방문"
                  />
                </div>

                {/* 주차 정보 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    주차 정보
                  </label>
                  <textarea
                    value={formData.metadata?.display?.festival?.parking_tips || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            festival: {
                              ...formData.metadata?.display?.festival,
                              parking_tips: e.target.value,
                            },
                          },
                        },
                      });
                    }}
                    rows={2}
                    className="input"
                    placeholder="행사장 주차 불가, 인근 공영주차장 이용 권장"
                  />
                </div>
              </div>
            </section>
          )}

          {/* 행사 특화 필드 */}
          {formData.mainCategory === '행사' && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">📅 행사 특화 정보</h3>
              <div className="space-y-4">
                {/* 참가 대상 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    참가 대상
                  </label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.event?.target_audience || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            event: {
                              ...formData.metadata?.display?.event,
                              target_audience: e.target.value,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="대학생, 취준생, 초등학생 이상"
                  />
                </div>

                {/* 정원 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    정원
                  </label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.event?.capacity || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            event: {
                              ...formData.metadata?.display?.event,
                              capacity: e.target.value,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="선착순 50명, 정원 100명"
                  />
                </div>

                {/* 사전 등록 정보 */}
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h5 className="font-semibold mb-3 text-sm">📝 사전 등록 정보</h5>

                  {/* 사전 등록 필요 여부 */}
                  <div className="mb-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.metadata?.display?.event?.registration?.required || false}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            metadata: {
                              ...formData.metadata,
                              display: {
                                ...formData.metadata?.display,
                                event: {
                                  ...formData.metadata?.display?.event,
                                  registration: {
                                    ...formData.metadata?.display?.event?.registration,
                                    required: e.target.checked,
                                  },
                                },
                              },
                            },
                          });
                        }}
                        className="rounded"
                      />
                      <span className="text-sm font-medium">사전 등록 필요</span>
                    </label>
                  </div>

                  {/* 사전 등록 링크 (필요한 경우에만) */}
                  {formData.metadata?.display?.event?.registration?.required && (
                    <>
                      <div className="mb-3">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          등록 링크
                        </label>
                        <input
                          type="url"
                          value={formData.metadata?.display?.event?.registration?.link || ''}
                          onChange={(e) => {
                            setFormData({
                              ...formData,
                              metadata: {
                                ...formData.metadata,
                                display: {
                                  ...formData.metadata?.display,
                                  event: {
                                    ...formData.metadata?.display?.event,
                                    registration: {
                                      ...formData.metadata?.display?.event?.registration,
                                      link: e.target.value,
                                    },
                                  },
                                },
                              },
                            });
                          }}
                          className="input text-sm"
                          placeholder="https://..."
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          마감일
                        </label>
                        <input
                          type="date"
                          value={formData.metadata?.display?.event?.registration?.deadline || ''}
                          onChange={(e) => {
                            setFormData({
                              ...formData,
                              metadata: {
                                ...formData.metadata,
                                display: {
                                  ...formData.metadata?.display,
                                  event: {
                                    ...formData.metadata?.display?.event,
                                    registration: {
                                      ...formData.metadata?.display?.event?.registration,
                                      deadline: e.target.value,
                                    },
                                  },
                                },
                              },
                            });
                          }}
                          className="input text-sm"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* 팝업 특화 필드 */}
          {formData.mainCategory === '팝업' && (
            <section>
              <h3 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🏪 팝업 특화 정보</h3>
              <div className="space-y-4">
                {/* 브랜드 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    브랜드 (쉼표로 구분)
                  </label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.popup?.brands?.join(', ') || ''}
                    onChange={(e) => {
                      const brands = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            popup: {
                              ...formData.metadata?.display?.popup,
                              brands,
                              is_fnb: formData.metadata?.display?.popup?.is_fnb || false,
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="노티드, 케이스티파이"
                  />
                </div>

                {/* 팝업 타입 선택 (라디오 버튼) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    팝업 타입 선택
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="popup-type"
                        value="fnb"
                        checked={formData.metadata?.display?.popup?.type === 'fnb'}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            metadata: {
                              ...formData.metadata,
                              display: {
                                ...formData.metadata?.display,
                                popup: {
                                  ...formData.metadata?.display?.popup,
                                  type: 'fnb',
                                  brands: formData.metadata?.display?.popup?.brands || [],
                                },
                              },
                            },
                          });
                        }}
                      />
                      <span className="text-sm font-medium">🍰 F&B (디저트/카페)</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="popup-type"
                        value="collab"
                        checked={formData.metadata?.display?.popup?.type === 'collab'}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            metadata: {
                              ...formData.metadata,
                              display: {
                                ...formData.metadata?.display,
                                popup: {
                                  ...formData.metadata?.display?.popup,
                                  type: 'collab',
                                  brands: formData.metadata?.display?.popup?.brands || [],
                                },
                              },
                            },
                          });
                        }}
                      />
                      <span className="text-sm font-medium">🤝 콜라보 (브랜드 협업)</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="popup-type"
                        value="general"
                        checked={formData.metadata?.display?.popup?.type === 'general' || !formData.metadata?.display?.popup?.type}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            metadata: {
                              ...formData.metadata,
                              display: {
                                ...formData.metadata?.display,
                                popup: {
                                  ...formData.metadata?.display?.popup,
                                  type: 'general',
                                  brands: formData.metadata?.display?.popup?.brands || [],
                                },
                              },
                            },
                          });
                        }}
                      />
                      <span className="text-sm font-medium">📦 일반 팝업</span>
                    </label>
                  </div>
                </div>

                {/* ⭐ 콜라보 설명 (type === 'collab'일 때만) */}
                {formData.metadata?.display?.popup?.type === 'collab' && (
                  <div className="ml-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                    <h5 className="font-semibold mb-3 text-sm">🤝 콜라보 정보</h5>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        콜라보 설명
                      </label>
                      <textarea
                        value={formData.metadata?.display?.popup?.collab_description || ''}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            metadata: {
                              ...formData.metadata,
                              display: {
                                ...formData.metadata?.display,
                                popup: {
                                  ...formData.metadata?.display?.popup,
                                  type: 'collab',
                                  collab_description: e.target.value,
                                  brands: formData.metadata?.display?.popup?.brands || [],
                                },
                              },
                            },
                          });
                        }}
                        className="textarea textarea-bordered w-full text-sm"
                        rows={3}
                        placeholder="예: 노티드와 산리오 캐릭터즈의 첫 공식 콜라보레이션"
                      />
                    </div>
                  </div>
                )}

                {/* ⭐ F&B 정보 (type === 'fnb'일 때만) */}
                {formData.metadata?.display?.popup?.type === 'fnb' && (
                  <div className="ml-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                    <h5 className="font-semibold mb-3 text-sm">🍰 메뉴 정보</h5>

                    {/* 시그니처 메뉴 */}
                    <div className="mb-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        ⭐ 시그니처 메뉴 (쉼표로 구분)
                      </label>
                      <input
                        type="text"
                        value={formData.metadata?.display?.popup?.fnb_items?.signature_menu?.join(', ') || ''}
                        onChange={(e) => {
                          const signature_menu = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setFormData({
                            ...formData,
                            metadata: {
                              ...formData.metadata,
                              display: {
                                ...formData.metadata?.display,
                                popup: {
                                  ...formData.metadata?.display?.popup,
                                  type: 'fnb',
                                  brands: formData.metadata?.display?.popup?.brands || [],
                                  fnb_items: {
                                    ...formData.metadata?.display?.popup?.fnb_items,
                                    signature_menu,
                                  },
                                },
                              },
                            },
                          });
                        }}
                        className="input text-sm"
                        placeholder="두쫀쿠, 쪽파 베이글, 딸기 케이크"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        대표 메뉴를 쉼표로 구분해서 입력하세요
                      </p>
                    </div>

                    {/* 메뉴 카테고리 */}
                    <div className="mb-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        메뉴 카테고리 (쉼표로 구분)
                      </label>
                      <input
                        type="text"
                        value={formData.metadata?.display?.popup?.fnb_items?.menu_categories?.join(', ') || ''}
                        onChange={(e) => {
                          const menu_categories = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setFormData({
                            ...formData,
                            metadata: {
                              ...formData.metadata,
                              display: {
                                ...formData.metadata?.display,
                                popup: {
                                  ...formData.metadata?.display?.popup,
                                  type: 'fnb',
                                  brands: formData.metadata?.display?.popup?.brands || [],
                                  fnb_items: {
                                    ...formData.metadata?.display?.popup?.fnb_items,
                                    menu_categories,
                                  },
                                },
                              },
                            },
                          });
                        }}
                        className="input text-sm"
                        placeholder="디저트, 음료, 브런치"
                      />
                    </div>

                    {/* 가격대 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        가격대
                      </label>
                      <input
                        type="text"
                        value={formData.metadata?.display?.popup?.fnb_items?.price_range || ''}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            metadata: {
                              ...formData.metadata,
                              display: {
                                ...formData.metadata?.display,
                                popup: {
                                  ...formData.metadata?.display?.popup,
                                  type: 'fnb',
                                  brands: formData.metadata?.display?.popup?.brands || [],
                                  fnb_items: {
                                    ...formData.metadata?.display?.popup?.fnb_items,
                                    price_range: e.target.value,
                                  },
                                },
                              },
                            },
                          });
                        }}
                        className="input text-sm"
                        placeholder="5천원-1만원대"
                      />
                    </div>
                  </div>
                )}

                {/* 일반 굿즈 정보 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    판매 굿즈 (쉼표로 구분)
                  </label>
                  <input
                    type="text"
                    value={formData.metadata?.display?.popup?.goods_items?.join(', ') || ''}
                    onChange={(e) => {
                      const goods_items = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            popup: {
                              ...formData.metadata?.display?.popup,
                              goods_items,
                              is_fnb: formData.metadata?.display?.popup?.is_fnb || false,
                              brands: formData.metadata?.display?.popup?.brands || [],
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                    placeholder="키링, 에코백, 포토카드"
                  />
                </div>

                {/* 포토존 */}
                <div>
                  <label className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={formData.metadata?.display?.popup?.photo_zone || false}
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          metadata: {
                            ...formData.metadata,
                            display: {
                              ...formData.metadata?.display,
                              popup: {
                                ...formData.metadata?.display?.popup,
                                photo_zone: e.target.checked,
                                is_fnb: formData.metadata?.display?.popup?.is_fnb || false,
                                brands: formData.metadata?.display?.popup?.brands || [],
                              },
                            },
                          },
                        });
                      }}
                    />
                    <span className="text-sm font-medium">포토존 있음</span>
                  </label>
                  
                  {/* 포토존 상세 설명 (포토존이 있을 때만 표시) */}
                  {formData.metadata?.display?.popup?.photo_zone && (
                    <div className="ml-6 mt-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        포토존 상세 설명
                      </label>
                      <input
                        type="text"
                        value={formData.metadata?.display?.popup?.photo_zone_desc || ''}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            metadata: {
                              ...formData.metadata,
                              display: {
                                ...formData.metadata?.display,
                                popup: {
                                  ...formData.metadata?.display?.popup,
                                  photo_zone_desc: e.target.value,
                                  is_fnb: formData.metadata?.display?.popup?.is_fnb || false,
                                  brands: formData.metadata?.display?.popup?.brands || [],
                                },
                              },
                            },
                          });
                        }}
                        className="input"
                        placeholder="예: 대형 곰인형 포토존, 2층 입구"
                      />
                    </div>
                  )}
                </div>

                {/* 대기 시간 힌트 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    대기 시간 수준
                  </label>
                  <select
                    value={formData.metadata?.display?.popup?.waiting_hint?.level || ''}
                    onChange={(e) => {
                      const level = e.target.value as 'low' | 'medium' | 'high' | '';
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          display: {
                            ...formData.metadata?.display,
                            popup: {
                              ...formData.metadata?.display?.popup,
                              waiting_hint: level ? {
                                level,
                                text: formData.metadata?.display?.popup?.waiting_hint?.text || '',
                              } : undefined,
                              is_fnb: formData.metadata?.display?.popup?.is_fnb || false,
                              brands: formData.metadata?.display?.popup?.brands || [],
                            },
                          },
                        },
                      });
                    }}
                    className="input"
                  >
                    <option value="">선택 안함</option>
                    <option value="low">🟢 Low (빠름)</option>
                    <option value="medium">🟡 Medium (보통)</option>
                    <option value="high">🔴 High (혼잡)</option>
                  </select>
                  
                  {/* 대기 시간 설명 텍스트 */}
                  {formData.metadata?.display?.popup?.waiting_hint?.level && (
                    <div className="mt-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        대기 시간 상세 설명
                      </label>
                      <textarea
                        value={formData.metadata?.display?.popup?.waiting_hint?.text || ''}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            metadata: {
                              ...formData.metadata,
                              display: {
                                ...formData.metadata?.display,
                                popup: {
                                  ...formData.metadata?.display?.popup,
                                  waiting_hint: {
                                    level: formData.metadata?.display?.popup?.waiting_hint?.level!,
                                    text: e.target.value,
                                  },
                                  is_fnb: formData.metadata?.display?.popup?.is_fnb || false,
                                  brands: formData.metadata?.display?.popup?.brands || [],
                                },
                              },
                            },
                          });
                        }}
                        className="textarea textarea-bordered w-full text-sm"
                        rows={2}
                        placeholder="예: 평일 오후는 대기 없음, 주말 오픈런 추천"
                      />
                    </div>
                  )}
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

      {/* Field Selector Modal */}
      {showFieldSelectorModal && (
        <FieldSelectorModal
          mainCategory={formData.mainCategory}
          onConfirm={(forceFields) => {
            setShowFieldSelectorModal(false);
            handleAIEnrichPreview(forceFields);
          }}
          onCancel={() => setShowFieldSelectorModal(false)}
        />
      )}
    </div>
  );
}

