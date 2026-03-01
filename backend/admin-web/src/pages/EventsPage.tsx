import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../services/api';
import type { Event } from '../types';
import CompletenessBar from '../components/CompletenessBar';
import DeployChecklist from '../components/DeployChecklist';
import FieldSelectorModal from '../components/FieldSelectorModal';
import { getFieldDef } from '../lib/fieldRegistry';

// 이미지가 없거나 placeholder인지 확인하는 헬퍼 함수
const isPlaceholderImage = (imageUrl: string | null | undefined): boolean => {
  if (!imageUrl || imageUrl === '') return true;
  const lowerUrl = imageUrl.toLowerCase();
  return lowerUrl.includes('placeholder') || lowerUrl.includes('/defaults/');
};

export default function EventsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [isFeatured, setIsFeatured] = useState('');
  const [hasImage, setHasImage] = useState(''); // 이미지 필터 추가
  const [recentlyCollected, setRecentlyCollected] = useState(''); // 🆕 최근 수집 필터
  const [completeness, setCompleteness] = useState(''); // 🆕 데이터 완성도 필터
  const [sortBy, setSortBy] = useState('updated_at_desc'); // 정렬 기준
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [enriching, setEnriching] = useState(false);

  // AI 보완 — 필드 선택 모달
  const [showFieldSelectorModal, setShowFieldSelectorModal] = useState(false);
  // handleAIEnrichDirect 내부용 (UI 노출 안 함)
  const [selectedFields] = useState<string[]>([]);

  // 🔍 [RUNTIME DEBUG] Component mount
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[EventsPage] 🚀 MOUNTED', { time: new Date().toISOString() });
    }
  }, []);

  // Debounce search (500ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset to page 1 when search changes
    }, 500);

    return () => clearTimeout(timer);
  }, [search]);

  const { data: eventsData, isLoading, refetch } = useQuery({
    queryKey: ['events', page, debouncedSearch, category, isFeatured, hasImage, recentlyCollected, completeness, sortBy],
    queryFn: () =>
      adminApi.getEvents({
        page,
        size: 20,
        q: debouncedSearch || undefined,
        category: category || undefined,
        isFeatured: isFeatured || undefined,
        hasImage: hasImage || undefined,
        isDeleted: 'false',
        sort: sortBy,
        recentlyCollected: recentlyCollected || undefined, // 🆕 추가
        completeness: completeness || undefined, // 🆕 완성도 필터
      }),
  });

  // 🆕 AI만으로 빈 필드 보완 (네이버 API 없이)
  const handleAIEnrichDirect = async () => {
    if (!selectedEvent) {
      alert('이벤트가 선택되지 않았습니다.');
      return;
    }

    if (!selectedEvent.id) {
      alert('이벤트 ID가 없습니다.');
      console.error('[AI-Direct] Missing event ID:', selectedEvent);
      return;
    }

    // ⚠️ AI 보완 전에 먼저 저장
    const confirmSave = window.confirm(
      '⚠️ AI 보완을 실행하기 전에 현재 입력한 내용을 저장합니다.\n계속하시겠습니까?'
    );
    
    if (!confirmSave) {
      return;
    }

    console.log('[AI-Direct] Saving current changes before enrichment...');
    
    try {
      // 1️⃣ 먼저 저장 (silent mode)
      await handleSaveEvent(true);
      console.log('[AI-Direct] ✅ Saved successfully, now starting enrichment');
    } catch (saveError: any) {
      console.error('[AI-Direct] Save failed:', saveError);
      alert('❌ 저장에 실패했습니다. AI 보완을 계속할 수 없습니다.');
      return;
    }

    console.log('[AI-Direct] Starting enrichment:', {
      eventId: selectedEvent.id,
      eventIdType: typeof selectedEvent.id,
      eventTitle: selectedEvent.title,
      selectedFields: selectedFields,
      fieldsCount: selectedFields.length,
    });

    setEnriching(true);
    try {
      const _label = selectedFields.length > 0 ? 'AI만으로 선택한 필드 재생성' : 'AI만으로 빈 필드 보완';
      const _forceFields = selectedFields.length > 0 ? selectedFields : [];
      if (import.meta.env.DEV) {
        console.log(
          `[AI_BUTTON][CLICK] label="${_label}" eventId=${selectedEvent.id}` +
          ` payload=${JSON.stringify({ aiOnly: true, forceFields: _forceFields })}`
        );
      }

      // 2️⃣ AI 보완 실행
      const result = await adminApi.enrichEvent(selectedEvent.id, {
        forceFields: _forceFields,
        aiOnly: true,
        __buttonLabel: _label,
      });

      console.log('[AI-Direct] API response:', result);

      if (!result.success) {
        const errorCode = (result as any).errorCode;
        const detail = errorCode ? `\n\n[에러 코드: ${errorCode}]` : '';
        console.error('[AI-Enrich] Failed:', result);
        alert((result.message || 'AI 분석에 실패했습니다.') + detail);
        return;
      }

      // Phase 2: AI 제안 시스템 - suggestions가 있으면 제안으로 처리
      if (result.suggestions) {
        console.log('[AI Suggestions] Generated:', result.suggestions);
        
        // 제안 개수 및 출처 정보 수집
        const suggestionCount = Object.keys(result.suggestions).length;
        let sourcesText = '';
        
        // enriched가 있고 sources가 있으면 출처 정보 포함
        if (result.enriched && (result.enriched as any).sources) {
          const sources = (result.enriched as any).sources;
          if (Object.keys(sources).length > 0) {
            sourcesText = '\n\n📚 출처 정보:';
            Object.entries(sources).slice(0, 5).forEach(([fieldName, sourceInfo]: [string, any]) => {
              sourcesText += `\n  • ${fieldName}: ${sourceInfo.source}`;
              if (sourceInfo.evidence) {
                sourcesText += ` - "${sourceInfo.evidence}"`;
              }
              if (sourceInfo.confidence) {
                sourcesText += ` (신뢰도: ${sourceInfo.confidence}/10)`;
              }
            });
            if (Object.keys(sources).length > 5) {
              sourcesText += `\n  ... 외 ${Object.keys(sources).length - 5}개`;
            }
          }
        }
        
        alert(`✅ ${suggestionCount}개의 AI 제안이 생성되었습니다.${sourcesText}\n\n아래 "AI 제안" 섹션에서 확인하세요.`);
        
        // 이벤트 refetch하여 ai_suggestions 업데이트
        const updatedEvent = await adminApi.getEvent(selectedEvent.id);
        setSelectedEvent(updatedEvent.item);
        return;
      }

      alert(result.message || '✅ AI 보완 완료!');
      
      // 이벤트 refetch
      await refetch();
      
      // 상세 보기 업데이트
      const updatedEvent = await adminApi.getEvent(selectedEvent.id);
      setSelectedEvent(updatedEvent.item);
      
    } catch (error: any) {
      console.error('[AI-Direct] Full error:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers,
        }
      });
      
      const errorMessage = error.response?.data?.error 
        || error.response?.data?.message 
        || error.message 
        || '알 수 없는 오류';
      
      alert(`AI 분석 중 오류가 발생했습니다:\n\n${errorMessage}\n\n상태 코드: ${error.response?.status || 'N/A'}`);
    } finally {
      setEnriching(false);
    }
  };

  // 🆕 AI 보완 함수 (forceFields 지원)
  const handleAIEnrich = async (forceFields: string[] = []) => {
    if (!selectedEvent) return;

    // ⚠️ AI 보완 전에 먼저 저장 (forceFields가 비어있거나 강제 재생성이 아닌 경우)
    if (forceFields.length === 0 || !forceFields.includes('*')) {
      const confirmSave = window.confirm(
        '⚠️ AI 보완을 실행하기 전에 현재 입력한 내용을 저장합니다.\n계속하시겠습니까?'
      );
      
      if (!confirmSave) {
        return;
      }

      console.log('[AI-Enrich] Saving current changes before enrichment...');
      
      try {
        await handleSaveEvent(true);
        console.log('[AI-Enrich] ✅ Saved successfully, now starting enrichment');
      } catch (saveError: any) {
        console.error('[AI-Enrich] Save failed:', saveError);
        alert('❌ 저장에 실패했습니다. AI 보완을 계속할 수 없습니다.');
        return;
      }
    }

    setEnriching(true);
    try {
      const _ff = forceFields;
      const _label = _ff.includes('*')
        ? '전체 재생성(네이버+AI)'
        : _ff.length === 0
        ? '추천 보완(네이버+AI)'
        : `선택 필드 재생성(네이버+AI) [${_ff.join(',')}]`;
      if (import.meta.env.DEV) {
        console.log(
          `[AI_BUTTON][CLICK] label="${_label}" eventId=${selectedEvent.id}` +
          ` payload=${JSON.stringify({ aiOnly: false, forceFields: _ff })}`
        );
      }

      const result = await adminApi.enrichEvent(selectedEvent.id, { forceFields, __buttonLabel: _label });

      if (!result.success) {
        const errorCode = (result as any).errorCode;
        const detail = errorCode ? `\n\n[에러 코드: ${errorCode}]` : '';
        console.error('[AI-Enrich] Failed:', result);
        alert((result.message || 'AI 분석에 실패했습니다.') + detail);
        return;
      }

      // Phase 2: AI 제안 시스템 - suggestions가 있으면 제안으로 처리
      if (result.suggestions) {
        console.log('[AI Suggestions] Generated:', result.suggestions);
        
        // 제안 개수 및 출처 정보 수집
        const suggestionCount = Object.keys(result.suggestions).length;
        let sourcesText = '';
        
        // enriched가 있고 sources가 있으면 출처 정보 포함
        if (result.enriched && (result.enriched as any).sources) {
          const sources = (result.enriched as any).sources;
          if (Object.keys(sources).length > 0) {
            sourcesText = '\n\n📚 출처 정보:';
            Object.entries(sources).slice(0, 5).forEach(([fieldName, sourceInfo]: [string, any]) => {
              sourcesText += `\n  • ${fieldName}: ${sourceInfo.source}`;
              if (sourceInfo.evidence) {
                sourcesText += ` - "${sourceInfo.evidence}"`;
              }
              if (sourceInfo.confidence) {
                sourcesText += ` (신뢰도: ${sourceInfo.confidence}/10)`;
              }
            });
            if (Object.keys(sources).length > 5) {
              sourcesText += `\n  ... 외 ${Object.keys(sources).length - 5}개`;
            }
          }
        }
        
        alert(`✅ ${suggestionCount}개의 AI 제안이 생성되었습니다.${sourcesText}\n\n아래 "AI 제안" 섹션에서 확인하세요.`);
        
        // 이벤트 refetch하여 ai_suggestions 업데이트
        const updatedEvent = await adminApi.getEvent(selectedEvent.id);
        console.log('[AI Suggestions] Updated event:', {
          id: updatedEvent.item.id,
          title: updatedEvent.item.title,
          ai_suggestions: updatedEvent.item.ai_suggestions,
          suggestionCount: updatedEvent.item.ai_suggestions ? Object.keys(updatedEvent.item.ai_suggestions).length : 0,
          suggestionKeys: updatedEvent.item.ai_suggestions ? Object.keys(updatedEvent.item.ai_suggestions) : [],
        });
        
        // State 업데이트
        setSelectedEvent(updatedEvent.item);
        
        console.log('[AI Suggestions] State updated, component should re-render');
        return;
      }

      // Phase 1: 기존 enriched 로직 (호환성 유지)
      if (!result.enriched) {
        console.error('[AI-Enrich] No enriched data in response:', result);
        alert(result.message || 'AI 분석에 실패했습니다. (enriched 데이터 없음)');
        return;
      }

      const enriched = result.enriched;
      
      // 🆕 디버깅: AI 응답 확인
      console.log('[Admin] AI Enrichment Response:', {
        exhibition_display: (enriched as any).exhibition_display,
        performance_display: (enriched as any).performance_display,
        category: selectedEvent.main_category,
      });

      // 결과를 현재 이벤트에 반영 (기존 값 유지, 비어있는 필드만 AI가 채움)
      setSelectedEvent({
        ...selectedEvent,
        // 기본 정보 (기존 값 우선)
        start_at: enriched.start_date || selectedEvent.start_at,
        end_at: enriched.end_date || selectedEvent.end_at,
        venue: enriched.venue || selectedEvent.venue,
        address: enriched.address || selectedEvent.address,
        overview: enriched.overview || selectedEvent.overview,
        
        // 지오코딩 결과
        lat: enriched.lat || selectedEvent.lat || null,
        lng: enriched.lng || selectedEvent.lng || null,
        region: enriched.region || selectedEvent.region || null,
        
        // 추가 정보 (기존 값 우선)
        derived_tags: enriched.derived_tags || selectedEvent.derived_tags,
        opening_hours: enriched.opening_hours || selectedEvent.opening_hours,
        price_min: enriched.price_min ?? selectedEvent.price_min,
        price_max: enriched.price_max ?? selectedEvent.price_max,
        
        // 외부 링크 (각 필드별로 기존 값 우선)
        external_links: {
          official: enriched.external_links?.official || selectedEvent.external_links?.official || undefined,
          ticket: enriched.external_links?.ticket || selectedEvent.external_links?.ticket || undefined,
          reservation: enriched.external_links?.reservation || selectedEvent.external_links?.reservation || undefined,
          instagram: (enriched.external_links as any)?.instagram || selectedEvent.external_links?.instagram || undefined,
        },
        
        // 🆕 Phase 3: 전시/공연 특화 필드
        metadata: {
          ...selectedEvent.metadata,
          display: {
            ...selectedEvent.metadata?.display,
            exhibition: (enriched as any).exhibition_display || selectedEvent.metadata?.display?.exhibition,
            performance: (enriched as any).performance_display || selectedEvent.metadata?.display?.performance,
          },
        },
      });

      // 성공 메시지 (실제로 새로 채워진 항목만 표시)
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
      if (enriched.external_links?.official) filledFields.push('공식홈페이지');
      if (enriched.external_links?.ticket) filledFields.push('티켓링크');
      if (enriched.external_links?.reservation) filledFields.push('예약링크');
      // 🆕 Phase 3: 전시/공연 특화 필드
      if ((enriched as any).exhibition_display) filledFields.push('전시 특화 정보');
      if ((enriched as any).performance_display) filledFields.push('공연 특화 정보');

      // 🆕 AI가 못 채운 필드 피드백
      const skippedFields = (result as any).skipped_fields || [];
      const skippedNoInfo = skippedFields.filter((f: any) => f.reason.includes('찾지 못함'));

      // 🆕 출처 정보 포함
      const sources = (enriched as any).sources || {};
      let sourcesText = '';
      if (Object.keys(sources).length > 0) {
        sourcesText = '\n\n📚 출처 정보:';
        Object.entries(sources).slice(0, 5).forEach(([fieldName, sourceInfo]: [string, any]) => {
          sourcesText += `\n  • ${fieldName}: ${sourceInfo.source}`;
          if (sourceInfo.evidence) {
            sourcesText += ` - "${sourceInfo.evidence}"`;
          }
          if (sourceInfo.confidence) {
            sourcesText += ` (신뢰도: ${sourceInfo.confidence}/10)`;
          }
        });
        if (Object.keys(sources).length > 5) {
          sourcesText += `\n  ... 외 ${Object.keys(sources).length - 5}개`;
        }
      }

      let message = filledFields.length > 0
        ? `✅ AI 분석 완료!\n\n새로 채워진 항목: ${filledFields.join(', ')}${sourcesText}`
        : '⚠️ AI 분석 완료\n\n새로 채워진 항목이 없습니다.';

      if (skippedNoInfo.length > 0) {
        const skippedList = skippedNoInfo.map((f: any) => `  • ${f.field}: ${f.reason}`).join('\n');
        message += `\n\n❌ 못 채운 필드:\n${skippedList}`;
      }

      if (filledFields.length > 0) {
        message += '\n\n결과를 확인 후 저장하세요.';
      }

      if (filledFields.length > 0 || skippedNoInfo.length > 0) {
        alert(message);
      } else {
        alert(`✅ AI 분석 완료!\n\n모든 필드에 이미 값이 있어서 변경사항이 없습니다.`);
      }
    } catch (error: any) {
      console.error('[AIEnrich] Error:', {
        message: error.message,
        status: error.response?.status,
        responseData: error.response?.data,
        url: error.config?.url,
      });
      const detail = error.response?.data?.message || error.response?.data?.error || error.message || '알 수 없는 오류';
      const status = error.response?.status ? ` (HTTP ${error.response.status})` : '';
      alert(`AI 분석 중 오류가 발생했습니다${status}:\n\n${detail}`);
    } finally {
      setEnriching(false);
    }
  };

  // 🆕 Phase 3: AI 제안 적용
  const handleApplySuggestion = async (fieldName: string) => {
    if (!selectedEvent) return;

    try {
      const result = await adminApi.applySuggestion(selectedEvent.id, fieldName);
      
      if (result.success) {
        alert(`✅ ${result.message}`);
        // 이벤트 refetch하여 최신 데이터 반영
        setSelectedEvent(result.event);
      } else {
        alert('제안 적용에 실패했습니다.');
      }
    } catch (error: any) {
      console.error('[Apply Suggestion] Error:', error);
      alert('제안 적용 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
    }
  };

  // 🆕 Phase 3: AI 제안 무시
  const handleDismissSuggestion = async (fieldName: string) => {
    if (!selectedEvent) return;

    if (!confirm(`이 제안을 무시하시겠습니까?\n\n필드: ${fieldName}`)) {
      return;
    }

    try {
      const result = await adminApi.dismissSuggestion(selectedEvent.id, fieldName);
      
      if (result.success) {
        // ai_suggestions에서 해당 필드 제거
        const updatedSuggestions = { ...selectedEvent.ai_suggestions };
        delete updatedSuggestions[fieldName];
        setSelectedEvent({
          ...selectedEvent,
          ai_suggestions: updatedSuggestions,
        });
        alert(`✅ ${result.message}`);
      } else {
        alert('제안 무시에 실패했습니다.');
      }
    } catch (error: any) {
      console.error('[Dismiss Suggestion] Error:', error);
      alert('제안 무시 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
    }
  };

  // 🆕 필드 출처 배지 생성 헬퍼
  const getFieldSourceBadge = (fieldName: string) => {
    if (!selectedEvent?.field_sources) {
      console.log(`[Badge] No field_sources for event ${selectedEvent?.id}`);
      return null;
    }
    
    const source = selectedEvent.field_sources[fieldName];
    if (!source) {
      console.log(`[Badge] No source for field: ${fieldName}`);
      return null;
    }
    
    console.log(`[Badge] Field: ${fieldName}, Source: ${source.source}`);
    
    const badges: { [key: string]: { emoji: string; label: string; color: string } } = {
      'KOPIS': { emoji: '🟢', label: 'KOPIS', color: 'bg-green-100 text-green-700' },
      'Culture': { emoji: '🟢', label: 'Culture', color: 'bg-green-100 text-green-700' },
      'TourAPI': { emoji: '🟢', label: 'TourAPI', color: 'bg-green-100 text-green-700' },
      'AI': { emoji: '🟡', label: 'AI', color: 'bg-yellow-100 text-yellow-700' },
      'Caption': { emoji: '📋', label: '캡션', color: 'bg-blue-100 text-blue-700' },
      'Manual': { emoji: '🟣', label: '수동', color: 'bg-purple-100 text-purple-700' },
      'CALCULATED': { emoji: '⚫', label: '계산', color: 'bg-gray-100 text-gray-700' },
    };
    
    const badgeInfo = badges[source.source] || { emoji: '⚪', label: '알수없음', color: 'bg-gray-100 text-gray-500' };
    const confidence = source.confidence || 0;
    
    // 디버깅: 알수없음이 뜨는 경우 로그 출력
    if (!badges[source.source]) {
      console.warn(`[Badge] Unknown source type: "${source.source}" for field: ${fieldName}`);
      console.warn(`[Badge] Available badges:`, Object.keys(badges));
    }
    
    return (
      <span 
        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${badgeInfo.color}`}
        title={`출처: ${source.sourceDetail || source.source}\n신뢰도: ${confidence}%\n업데이트: ${source.updatedAt || source.applied_at || 'N/A'}`}
      >
        {badgeInfo.emoji} {badgeInfo.label}
      </span>
    );
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedEvent) return;

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

      // 업로드 성공 → 이벤트 이미지 URL 업데이트
      setSelectedEvent({
        ...selectedEvent,
        image_url: result.url,
      });

      alert(`✅ 이미지 업로드 완료! (${result.sizeKB}KB, WebP)`);
    } catch (error: any) {
      console.error('[Upload] Error:', error);
      const errorMsg = error.response?.data?.error || '업로드 실패. 다시 시도해주세요.';
      alert(errorMsg);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDeleteEvent = async () => {
    if (!selectedEvent) return;

    const confirmed = window.confirm(
      `정말로 "${selectedEvent.title}" 이벤트를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`
    );

    if (!confirmed) return;

    // 삭제 사유 입력 (선택)
    const reason = window.prompt('삭제 사유를 입력하세요 (선택):');

    try {
      await adminApi.deleteEvent(selectedEvent.id, reason || undefined);
      alert('✅ 이벤트가 삭제되었습니다.');

      // 목록 새로고침 및 모달 닫기
      setSelectedEvent(null);
      refetch(); // useQuery의 refetch 함수 사용
    } catch (error: any) {
      console.error('[Delete] Error:', error);
      alert('❌ 삭제 실패: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleSaveEvent = async (silent: boolean = false) => {
    if (!selectedEvent) return;

    try {
      // 날짜 형식 변환: ISO 8601 → YYYY-MM-DD
      const formatDate = (dateStr: string) => {
        if (!dateStr) return dateStr;
        return dateStr.split('T')[0]; // "2026-06-05T15:00:00.000Z" → "2026-06-05"
      };

      // 업데이트 데이터 구성
      const updateData: any = {
        title: selectedEvent.title,
        display_title: selectedEvent.display_title,
        main_category: selectedEvent.main_category,
        sub_category: selectedEvent.sub_category,
        start_at: formatDate(selectedEvent.start_at),
        end_at: selectedEvent.end_at ? formatDate(selectedEvent.end_at) : '',
        venue: selectedEvent.venue,
        address: selectedEvent.address,
        overview: selectedEvent.overview,
        image_url: selectedEvent.image_url,
        is_free: selectedEvent.is_free,
        price_info: selectedEvent.price_info,
        price_min: selectedEvent.price_min,
        price_max: selectedEvent.price_max,
        popularity_score: selectedEvent.popularity_score,
        is_featured: selectedEvent.is_featured,
        featured_order: selectedEvent.featured_order,
        // 추가 필드
        source_tags: selectedEvent.source_tags,
        derived_tags: selectedEvent.derived_tags,
        opening_hours: selectedEvent.opening_hours,
        external_links: selectedEvent.external_links,
        // 주차 정보
        parking_available: selectedEvent.parking_available ?? null,
        parking_info: selectedEvent.parking_info || null,
        // 🆕 Phase 3: metadata (카테고리별 특화 필드)
        metadata: selectedEvent.metadata,
      };

      // 🆕 좌표가 null이 아닐 때만 포함 (null이면 백엔드가 자동 지오코딩)
      if (selectedEvent.lat !== null && selectedEvent.lng !== null) {
        updateData.lat = selectedEvent.lat;
        updateData.lng = selectedEvent.lng;
        updateData.region = selectedEvent.region;
      }

      await adminApi.updateEvent(selectedEvent.id, updateData);
      if (!silent) {
        alert('✅ 저장되었습니다!');
      }
      
      // 저장 후 이벤트 다시 불러오기 (지오코딩 결과 반영)
      const updatedEvent = await adminApi.getEvent(selectedEvent.id);
      setSelectedEvent(updatedEvent.item);
      
      refetch();
    } catch (error) {
      if (!silent) {
        alert('❌ 저장 실패: ' + (error as Error).message);
      }
      throw error; // 호출하는 쪽에서 catch할 수 있도록 에러를 던짐
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">이벤트 관리</h2>
          <p className="text-gray-600 mt-2">전체 이벤트를 조회하고 관리하세요</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <input
            type="text"
            placeholder="제목 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="input"
          >
            <option value="">모든 카테고리</option>
            <option value="공연">공연</option>
            <option value="전시">전시</option>
            <option value="축제">축제</option>
            <option value="행사">행사</option>
            <option value="팝업">팝업</option>
          </select>
          <select
            value={hasImage}
            onChange={(e) => setHasImage(e.target.value)}
            className="input"
          >
            <option value="">이미지: 전체</option>
            <option value="true">✅ 이미지 있음</option>
            <option value="false">⚠️ 이미지 없음</option>
          </select>
          <select
            value={isFeatured}
            onChange={(e) => setIsFeatured(e.target.value)}
            className="input"
          >
            <option value="">Featured: 전체</option>
            <option value="true">Featured: Yes</option>
            <option value="false">Featured: No</option>
          </select>
          <select
            value={recentlyCollected}
            onChange={(e) => {
              setRecentlyCollected(e.target.value);
              setPage(1); // Reset to page 1 when filter changes
            }}
            className="input"
          >
            <option value="">수집 시기: 전체</option>
            <option value="24h">🆕 최근 24시간</option>
            <option value="7d">📅 최근 7일</option>
            <option value="30d">📆 최근 30일</option>
          </select>
          <select
            value={completeness}
            onChange={(e) => {
              setCompleteness(e.target.value);
              setPage(1); // Reset to page 1 when filter changes
            }}
            className="input"
          >
            <option value="">완성도: 전체</option>
            <option value="empty">🔴 미완료 (필수 필드 누락)</option>
            <option value="poor">🟠 부족 (AI 보강 미완료)</option>
            <option value="good">🟡 양호 (공통 필드 완료)</option>
            <option value="excellent">🟢 완벽 (카테고리 특화 포함)</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value);
              setPage(1); // Reset to page 1 when sort changes
            }}
            className="input"
          >
            <option value="updated_at_desc">최근 수정순</option>
            <option value="created_at_desc">최근 생성순</option>
            <option value="start_at_asc">시작일 빠른순</option>
            <option value="start_at_desc">시작일 늦은순</option>
            <option value="end_at_asc">종료일 빠른순</option>
            <option value="end_at_desc">종료일 늦은순</option>
          </select>
        </div>
      </div>

      {/* Events Table */}
      <div className="card">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      제목
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      지역
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      카테고리
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      장소
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      기간
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      인기도
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Buzz
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      완성도
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      상태
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {eventsData?.items && eventsData.items.length > 0 ? (
                    eventsData.items.map((event) => (
                      <tr
                        key={event.id}
                        onClick={() => setSelectedEvent(event)}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-4 py-4">
                          <div className="font-medium text-gray-900 truncate max-w-xs">
                            {event.title}
                          </div>
                          {event.is_free && (
                            <span className="text-xs text-green-600 font-medium">무료</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700">{event.region || '-'}</td>
                        <td className="px-4 py-4 text-sm text-gray-700">
                          <div>{event.main_category}</div>
                          {event.sub_category && (
                            <div className="text-xs text-gray-500">{event.sub_category}</div>
                          )}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700 truncate max-w-xs">
                          {event.venue || '-'}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700 whitespace-nowrap">
                          <div>{event.start_at?.split('T')[0]}</div>
                          <div className="text-xs text-gray-500">
                            ~ {event.end_at?.split('T')[0] || '?'}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700 text-center">
                          {event.popularity_score || 0}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700 text-center">
                          {event.buzz_score || 0}
                        </td>
                        <td className="px-4 py-4">
                          {(event as any)._completeness ? (
                            <div className="w-32">
                              <CompletenessBar
                                percentage={(event as any)._completeness.percentage}
                                level={(event as any)._completeness.level}
                                showLabel={false}
                                size="sm"
                              />
                              <div className="text-xs text-gray-500 mt-1">
                                {(event as any)._completeness.percentage}%
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-sm">
                          <div className="flex flex-col gap-1">
                            {event.is_featured && (
                              <span className="badge badge-purple text-xs">Featured</span>
                            )}
                            {event.is_ending_soon && (
                              <span className="badge badge-red text-xs">곧 종료</span>
                            )}
                            {isPlaceholderImage(event.image_url) && (
                              <span className="badge badge-yellow text-xs">⚠️ 이미지 필요</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                        이벤트가 없습니다
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex justify-between items-center mt-6 pt-6 border-t border-gray-200">
              <div className="text-sm text-gray-600">
                총 {eventsData?.totalCount || 0}개 이벤트
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn-secondary disabled:opacity-50"
                >
                  이전
                </button>
                <span className="px-4 py-2 text-gray-700">페이지 {page}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={(eventsData?.items.length || 0) < 20}
                  className="btn-secondary disabled:opacity-50"
                >
                  다음
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xl font-bold text-gray-900">이벤트 상세</h3>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
              
              {/* 데이터 완성도 바 */}
              {(selectedEvent as any)._completeness && (
                <div className="mb-2">
                  <CompletenessBar
                    percentage={(selectedEvent as any)._completeness.percentage}
                    level={(selectedEvent as any)._completeness.level}
                    showLabel={true}
                    size="md"
                  />
                </div>
              )}

              {/* 배포 우선순위 체크리스트 (Sticky) */}
              <div className="mb-3">
                <DeployChecklist event={selectedEvent} />
              </div>

              {/* AI 보완 버튼 3종 */}
              <div className="flex gap-2 flex-wrap">
                {/* 1. 추천 보완 */}
                <button
                  onClick={() => handleAIEnrich([])}
                  disabled={enriching}
                  className="btn btn-secondary text-sm flex items-center gap-2"
                >
                  {enriching ? '🔄 AI 분석 중...' : '🤖 추천 보완(네이버+AI)'}
                </button>

                {/* 2. 선택 필드 재생성 → 모달 */}
                <button
                  onClick={() => setShowFieldSelectorModal(true)}
                  disabled={enriching}
                  className="btn btn-outline text-sm flex items-center gap-2"
                >
                  🎯 선택 필드 재생성(네이버+AI)
                </button>

                {/* 3. 전체 재생성 */}
                <button
                  onClick={() => {
                    if (confirm(
                      '⚠️ 전체 재생성을 실행할 거예요.\n\n수동으로 입력한 데이터를 포함해 모든 필드가 덮어씌워져요.\n정말 계속할까요?'
                    )) {
                      handleAIEnrich(['*']);
                    }
                  }}
                  disabled={enriching}
                  className="btn btn-danger text-sm flex items-center gap-2"
                >
                  🚨 전체 재생성(네이버+AI)
                </button>
              </div>

              {/* 선택 필드 재생성 모달 */}
              {showFieldSelectorModal && (
                <FieldSelectorModal
                  mainCategory={selectedEvent.main_category || ''}
                  onConfirm={(forceFields) => {
                    setShowFieldSelectorModal(false);
                    if (import.meta.env.DEV) {
                      console.log(
                        `[AI_BUTTON][CLICK] label="선택 필드 재생성" eventId=${selectedEvent.id}` +
                        ` payload=${JSON.stringify({ aiOnly: false, forceFields })}`
                      );
                    }
                    handleAIEnrich(forceFields);
                  }}
                  onCancel={() => setShowFieldSelectorModal(false)}
                />
              )}
              
              {/* 🆕 Phase 3: AI 제안 섹션 */}
              {selectedEvent.ai_suggestions && Object.keys(selectedEvent.ai_suggestions).length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-3">
                  <h4 className="text-sm font-bold text-blue-900 mb-3 flex items-center gap-2">
                    🤖 AI 제안 ({Object.keys(selectedEvent.ai_suggestions).filter(k => k !== 'overview_raw').length}개)
                  </h4>
                  <div className="space-y-3 max-h-60 overflow-y-auto">
                    {Object.entries(selectedEvent.ai_suggestions)
                      .filter(([fieldName]) => fieldName !== 'overview_raw') // 🆕 overview_raw는 내부용이므로 제안에서 제외
                      .map(([fieldName, suggestion]: [string, any]) => {
                      const conf = suggestion.confidence;
                      const emoji = conf >= 85 ? '🟢' : conf >= 70 ? '🟡' : conf >= 40 ? '🟠' : '🔴';
                      const confLevel = conf >= 85 ? 'high' : conf >= 70 ? 'medium' : conf >= 40 ? 'low' : 'very-low';
                      
                      // 필드 이름 한글화
                      const fieldLabels: { [key: string]: string } = {
                        'overview': '개요',
                        'overview_raw': '상세 개요 (내부)',
                        'start_at': '시작일',
                        'end_at': '종료일',
                        'venue': '장소',
                        'address': '주소',
                        'price_min': '최소 가격',
                        'price_max': '최대 가격',
                        'derived_tags': '태그',
                        'opening_hours': '운영/공연 시간',
                        'external_links.official': '공식 홈페이지',
                        'external_links.ticket': '예매 링크',
                        'external_links.reservation': '예약 링크',
                        // 전시 특화 정보
                        'metadata.display.exhibition.artists': '작가/아티스트',
                        'metadata.display.exhibition.genre': '전시 장르',
                        'metadata.display.exhibition.duration_minutes': '권장 관람 시간',
                        'metadata.display.exhibition.type': '전시 유형',
                        // 공연 특화 정보
                        'metadata.display.performance.cast': '출연진',
                        'metadata.display.performance.genre': '공연 장르',
                        'metadata.display.performance.duration_minutes': '공연 시간',
                        'metadata.display.performance.age_limit': '연령 제한',
                        'metadata.display.performance.discounts': '할인 정보',
                        // 팝업 특화 정보
                        'metadata.display.popup.type': '팝업 타입',
                        'metadata.display.popup.brands': '브랜드',
                        'metadata.display.popup.collab_description': '콜라보 설명',
                        'metadata.display.popup.fnb_items': 'F&B 메뉴',
                        'metadata.display.popup.fnb_items.signature_menu': '시그니처 메뉴',
                        'metadata.display.popup.fnb_items.menu_categories': '메뉴 카테고리',
                        'metadata.display.popup.fnb_items.price_range': '가격대',
                        'metadata.display.popup.goods_items': '굿즈',
                        'metadata.display.popup.photo_zone': '포토존 여부',
                        'metadata.display.popup.photo_zone_desc': '포토존 설명',
                        'metadata.display.popup.waiting_hint': '대기 시간',
                      };
                      
                      const fieldLabel = fieldLabels[fieldName] || fieldName;
                      
                      // 값 미리보기
                      let valuePreview: any = suggestion.value;
                      if (valuePreview === null || valuePreview === undefined) {
                        valuePreview = null; // warning으로 대체 표시
                      } else if (typeof valuePreview === 'string') {
                        valuePreview = valuePreview.length > 100
                          ? valuePreview.substring(0, 100) + '...'
                          : valuePreview;
                      } else if (Array.isArray(valuePreview)) {
                        valuePreview = valuePreview.join(', ');
                        if (valuePreview.length > 100) {
                          valuePreview = valuePreview.substring(0, 100) + '...';
                        }
                      } else if (typeof valuePreview === 'object') {
                        valuePreview = JSON.stringify(valuePreview, null, 2);
                        if (valuePreview.length > 100) {
                          valuePreview = valuePreview.substring(0, 100) + '...';
                        }
                      }
                      
                      return (
                        <div 
                          key={fieldName}
                          className={`bg-white border rounded-lg p-3 ${
                            confLevel === 'high' ? 'border-green-300' : 
                            confLevel === 'medium' ? 'border-yellow-300' : 
                            confLevel === 'low' ? 'border-orange-300' : 
                            'border-red-300'
                          }`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-sm text-gray-900">{fieldLabel}</span>
                                {(() => {
                                  const fieldDef = getFieldDef(fieldName);
                                  if (fieldDef) {
                                    if (fieldDef.scope === 'MASTER') {
                                      return (
                                        <span
                                          className="text-[10px] px-1 py-0.5 bg-purple-100 text-purple-700 rounded font-medium"
                                          title="일관성 우선: 같은 이벤트 변형들 간 동일한 값 유지"
                                        >
                                          M
                                        </span>
                                      );
                                    } else {
                                      return (
                                        <span
                                          className="text-[10px] px-1 py-0.5 bg-green-100 text-green-700 rounded font-medium"
                                          title="지역/지점/회차별: 각 이벤트마다 다른 값 가능"
                                        >
                                          V
                                        </span>
                                      );
                                    }
                                  }
                                  return null;
                                })()}
                                <span className="text-xs">
                                  {emoji} {conf}%
                                </span>
                                {suggestion.source === 'PUBLIC_API' && (
                                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">🟢 공공API</span>
                                )}
                                {suggestion.source === 'NAVER_API' && (
                                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">🔵 네이버API</span>
                                )}
                                {suggestion.source === 'AI' && (
                                  <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">🟡 AI</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mb-2">
                                <p className="text-xs text-gray-600">
                                  📚 출처: {suggestion.source_detail || suggestion.source || 'AI 추론'}
                                </p>
                                {(suggestion as any).url && (
                                  <a 
                                    href={(suggestion as any).url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                                  >
                                    🔗 확인하기
                                  </a>
                                )}
                              </div>
                              {suggestion.evidence && (
                                <p className="text-xs text-gray-500 mb-2 italic">
                                  💡 근거: "{suggestion.evidence}"
                                </p>
                              )}
                              {suggestion.reason && (
                                <p className="text-xs text-blue-600 mb-2 italic">
                                  🧠 AI 판단: "{suggestion.reason}"
                                </p>
                              )}
                              {(suggestion as any).confidence > 0 && (
                                <p className="text-xs text-gray-600 mb-2">
                                  ⭐ 신뢰도: {(suggestion as any).confidence}/10
                                </p>
                              )}
                              {/* 제안 실패: reasonMessage + 네이버 검색 버튼 */}
                              {suggestion.value === null && (suggestion as any).reasonMessage ? (
                                <div className="bg-orange-50 border border-orange-200 rounded p-2 mt-1">
                                  <p className="text-xs text-orange-700">
                                    ⚠️ {(suggestion as any).reasonMessage}
                                  </p>
                                  {(suggestion as any).naverSearchUrl && (() => {
                                    const url = (suggestion as any).naverSearchUrl;
                                    // 🆕 DEV 로깅: UI 링크 렌더링 시
                                    if (import.meta.env.DEV) {
                                      const queryMatch = url.match(/query=([^&]+)/);
                                      const derivedQuery = queryMatch ? decodeURIComponent(queryMatch[1]) : 'n/a';
                                      console.log(`[NAVER_LINK][RENDER] fieldKey=${fieldName} displayedUrl=${url.substring(0, 80)}... derivedQuery="${derivedQuery}"`);
                                    }

                                    return (
                                      <a
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 underline"
                                        onClick={() => {
                                          // 🆕 DEV 로깅: UI 링크 클릭 시
                                          if (import.meta.env.DEV) {
                                            const queryMatch = url.match(/query=([^&]+)/);
                                            const derivedQuery = queryMatch ? decodeURIComponent(queryMatch[1]) : 'n/a';
                                            console.log(`[NAVER_LINK][CLICK] fieldKey=${fieldName} displayedUrl=${url.substring(0, 80)}... derivedQuery="${derivedQuery}"`);
                                          }
                                        }}
                                      >
                                        🔍 네이버에서 직접 검색
                                      </a>
                                    );
                                  })()}
                                </div>
                              ) : valuePreview !== null ? (
                                <div className="bg-gray-50 p-2 rounded text-xs text-gray-700 overflow-x-auto">
                                  <pre className="whitespace-pre-wrap font-mono">{valuePreview}</pre>
                                </div>
                              ) : null}
                              {suggestion.warning && suggestion.value !== null && (
                                <p className="text-xs text-orange-600 mt-2">⚠️ {suggestion.warning}</p>
                              )}
                            </div>
                          </div>
                          {/* 적용/무시 버튼: 값이 있을 때만 표시 */}
                          {suggestion.value !== null && (
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleApplySuggestion(fieldName)}
                                className="btn btn-primary text-xs px-3 py-1 flex-1"
                              >
                                ✅ 적용
                              </button>
                              <button
                                onClick={() => handleDismissSuggestion(fieldName)}
                                className="btn btn-outline text-xs px-3 py-1 flex-1"
                              >
                                ❌ 무시
                              </button>
                            </div>
                          )}
                          {suggestion.value === null && (
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleDismissSuggestion(fieldName)}
                                className="btn btn-outline text-xs px-3 py-1"
                              >
                                ✕ 닫기
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 space-y-6">
              {/* 기본 정보 */}
              <section>
                <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">📝 기본 정보</h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                      제목 *
                      {getFieldSourceBadge('title')}
                    </label>
                    <input
                      type="text"
                      value={selectedEvent.title}
                      onChange={(e) => setSelectedEvent({ ...selectedEvent, title: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                      표시 제목 (Display Title)
                      {getFieldSourceBadge('display_title')}
                    </label>
                    <input
                      type="text"
                      value={selectedEvent.display_title || ''}
                      onChange={(e) =>
                        setSelectedEvent({ ...selectedEvent, display_title: e.target.value })
                      }
                      className="input"
                      placeholder="title과 동일하게 사용하려면 비워두세요"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                      개요
                      {getFieldSourceBadge('overview')}
                    </label>
                    <textarea
                      value={selectedEvent.overview || ''}
                      onChange={(e) =>
                        setSelectedEvent({ ...selectedEvent, overview: e.target.value })
                      }
                      className="input"
                      rows={4}
                      placeholder="이벤트 설명"
                    />
                  </div>
                </div>
              </section>

              {/* 카테고리 */}
              <section>
                <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🏷️ 카테고리</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                      메인 카테고리 *
                      {getFieldSourceBadge('main_category')}
                    </label>
                    <select
                      value={selectedEvent.main_category}
                      onChange={(e) =>
                        setSelectedEvent({ ...selectedEvent, main_category: e.target.value })
                      }
                      className="input"
                    >
                      <option value="공연">공연</option>
                      <option value="전시">전시</option>
                      <option value="축제">축제</option>
                      <option value="행사">행사</option>
                      <option value="팝업">팝업</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                      서브 카테고리
                      {getFieldSourceBadge('sub_category')}
                    </label>
                    <input
                      type="text"
                      value={selectedEvent.sub_category || ''}
                      onChange={(e) =>
                        setSelectedEvent({ ...selectedEvent, sub_category: e.target.value })
                      }
                      className="input"
                      placeholder="뮤지컬, 콘서트, 전시회 등"
                    />
                  </div>
                </div>
              </section>

              {/* 🆕 Phase 3: 전시 특화 필드 */}
              {selectedEvent.main_category === '전시' && (
                <section>
                  <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🎨 전시 특화 정보</h4>
                  <div className="space-y-4">
                    {/* 작가/아티스트 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        작가/아티스트 (쉼표로 구분)
                        {getFieldSourceBadge('metadata.display.exhibition.artists')}
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.metadata?.display?.exhibition?.artists?.join(', ') || ''}
                        onChange={(e) => {
                          const artists = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                exhibition: {
                                  ...selectedEvent.metadata?.display?.exhibition,
                                  artists,
                                  genre: selectedEvent.metadata?.display?.exhibition?.genre || [],
                                  type: selectedEvent.metadata?.display?.exhibition?.type || '기획전',
                                  duration_minutes: selectedEvent.metadata?.display?.exhibition?.duration_minutes || 60,
                                  facilities: selectedEvent.metadata?.display?.exhibition?.facilities || {
                                    photo_zone: false,
                                    audio_guide: false,
                                    goods_shop: false,
                                    cafe: false,
                                  },
                                  docent_tour: selectedEvent.metadata?.display?.exhibition?.docent_tour || null,
                                  special_programs: selectedEvent.metadata?.display?.exhibition?.special_programs || [],
                                  age_recommendation: selectedEvent.metadata?.display?.exhibition?.age_recommendation || null,
                                  photography_allowed: selectedEvent.metadata?.display?.exhibition?.photography_allowed || null,
                                  last_admission: selectedEvent.metadata?.display?.exhibition?.last_admission || null,
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
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        장르 (쉼표로 구분)
                        {getFieldSourceBadge('metadata.display.exhibition.genre')}
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.metadata?.display?.exhibition?.genre?.join(', ') || ''}
                        onChange={(e) => {
                          const genre = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                exhibition: {
                                  ...selectedEvent.metadata?.display?.exhibition,
                                  artists: selectedEvent.metadata?.display?.exhibition?.artists || [],
                                  genre,
                                  type: selectedEvent.metadata?.display?.exhibition?.type || '기획전',
                                  duration_minutes: selectedEvent.metadata?.display?.exhibition?.duration_minutes || 60,
                                  facilities: selectedEvent.metadata?.display?.exhibition?.facilities || {
                                    photo_zone: false,
                                    audio_guide: false,
                                    goods_shop: false,
                                    cafe: false,
                                  },
                                  docent_tour: selectedEvent.metadata?.display?.exhibition?.docent_tour || null,
                                  special_programs: selectedEvent.metadata?.display?.exhibition?.special_programs || [],
                                  age_recommendation: selectedEvent.metadata?.display?.exhibition?.age_recommendation || null,
                                  photography_allowed: selectedEvent.metadata?.display?.exhibition?.photography_allowed || null,
                                  last_admission: selectedEvent.metadata?.display?.exhibition?.last_admission || null,
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
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                          전시 유형
                          {getFieldSourceBadge('metadata.display.exhibition.type')}
                        </label>
                        <select
                          value={selectedEvent.metadata?.display?.exhibition?.type || '기획전'}
                          onChange={(e) => {
                            setSelectedEvent({
                              ...selectedEvent,
                              metadata: {
                                ...selectedEvent.metadata,
                                display: {
                                  ...selectedEvent.metadata?.display,
                                  exhibition: {
                                    ...selectedEvent.metadata?.display?.exhibition,
                                    artists: selectedEvent.metadata?.display?.exhibition?.artists || [],
                                    genre: selectedEvent.metadata?.display?.exhibition?.genre || [],
                                    type: e.target.value,
                                    duration_minutes: selectedEvent.metadata?.display?.exhibition?.duration_minutes || 60,
                                    facilities: selectedEvent.metadata?.display?.exhibition?.facilities || {
                                      photo_zone: false,
                                      audio_guide: false,
                                      goods_shop: false,
                                      cafe: false,
                                    },
                                    docent_tour: selectedEvent.metadata?.display?.exhibition?.docent_tour || null,
                                    special_programs: selectedEvent.metadata?.display?.exhibition?.special_programs || [],
                                    age_recommendation: selectedEvent.metadata?.display?.exhibition?.age_recommendation || null,
                                    photography_allowed: selectedEvent.metadata?.display?.exhibition?.photography_allowed || null,
                                    last_admission: selectedEvent.metadata?.display?.exhibition?.last_admission || null,
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
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                          권장 관람 시간 (분)
                          {getFieldSourceBadge('metadata.display.exhibition.duration_minutes')}
                        </label>
                        <input
                          type="number"
                          value={selectedEvent.metadata?.display?.exhibition?.duration_minutes || 60}
                          onChange={(e) => {
                            setSelectedEvent({
                              ...selectedEvent,
                              metadata: {
                                ...selectedEvent.metadata,
                                display: {
                                  ...selectedEvent.metadata?.display,
                                  exhibition: {
                                    ...selectedEvent.metadata?.display?.exhibition,
                                    artists: selectedEvent.metadata?.display?.exhibition?.artists || [],
                                    genre: selectedEvent.metadata?.display?.exhibition?.genre || [],
                                    type: selectedEvent.metadata?.display?.exhibition?.type || '기획전',
                                    duration_minutes: parseInt(e.target.value) || null,
                                    facilities: selectedEvent.metadata?.display?.exhibition?.facilities || {
                                      photo_zone: false,
                                      audio_guide: false,
                                      goods_shop: false,
                                      cafe: false,
                                    },
                                    docent_tour: selectedEvent.metadata?.display?.exhibition?.docent_tour || null,
                                    special_programs: selectedEvent.metadata?.display?.exhibition?.special_programs || [],
                                    age_recommendation: selectedEvent.metadata?.display?.exhibition?.age_recommendation || null,
                                    photography_allowed: selectedEvent.metadata?.display?.exhibition?.photography_allowed || null,
                                    last_admission: selectedEvent.metadata?.display?.exhibition?.last_admission || null,
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
                              checked={selectedEvent.metadata?.display?.exhibition?.facilities?.[facility.id as keyof typeof selectedEvent.metadata.display.exhibition.facilities] || false}
                              onChange={(e) => {
                                setSelectedEvent({
                                  ...selectedEvent,
                                  metadata: {
                                    ...selectedEvent.metadata,
                                    display: {
                                      ...selectedEvent.metadata?.display,
                                      exhibition: {
                                        ...selectedEvent.metadata?.display?.exhibition,
                                        artists: selectedEvent.metadata?.display?.exhibition?.artists || [],
                                        genre: selectedEvent.metadata?.display?.exhibition?.genre || [],
                                        type: selectedEvent.metadata?.display?.exhibition?.type || '기획전',
                                        duration_minutes: selectedEvent.metadata?.display?.exhibition?.duration_minutes || 60,
                                        facilities: {
                                          ...selectedEvent.metadata?.display?.exhibition?.facilities,
                                          [facility.id]: e.target.checked,
                                        },
                                        docent_tour: selectedEvent.metadata?.display?.exhibition?.docent_tour || null,
                                        special_programs: selectedEvent.metadata?.display?.exhibition?.special_programs || [],
                                        age_recommendation: selectedEvent.metadata?.display?.exhibition?.age_recommendation || null,
                                        photography_allowed: selectedEvent.metadata?.display?.exhibition?.photography_allowed || null,
                                        last_admission: selectedEvent.metadata?.display?.exhibition?.last_admission || null,
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
                        value={selectedEvent.metadata?.display?.exhibition?.docent_tour || ''}
                        onChange={(e) => {
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                exhibition: {
                                  ...selectedEvent.metadata?.display?.exhibition,
                                  artists: selectedEvent.metadata?.display?.exhibition?.artists || [],
                                  genre: selectedEvent.metadata?.display?.exhibition?.genre || [],
                                  type: selectedEvent.metadata?.display?.exhibition?.type || '기획전',
                                  duration_minutes: selectedEvent.metadata?.display?.exhibition?.duration_minutes || 60,
                                  facilities: selectedEvent.metadata?.display?.exhibition?.facilities || {
                                    photo_zone: false,
                                    audio_guide: false,
                                    goods_shop: false,
                                    cafe: false,
                                  },
                                  docent_tour: e.target.value || null,
                                  special_programs: selectedEvent.metadata?.display?.exhibition?.special_programs || [],
                                  age_recommendation: selectedEvent.metadata?.display?.exhibition?.age_recommendation || null,
                                  photography_allowed: selectedEvent.metadata?.display?.exhibition?.photography_allowed || null,
                                  last_admission: selectedEvent.metadata?.display?.exhibition?.last_admission || null,
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

              {/* 🆕 Phase 3: 공연 특화 필드 */}
              {selectedEvent.main_category === '공연' && (
                <section>
                  <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🎭 공연 특화 정보</h4>
                  <div className="space-y-4">
                    {/* 출연진 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        출연진 (쉼표로 구분)
                        {getFieldSourceBadge('metadata.display.performance.cast')}
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.metadata?.display?.performance?.cast?.join(', ') || ''}
                        onChange={(e) => {
                          const cast = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                performance: {
                                  ...selectedEvent.metadata?.display?.performance,
                                  cast,
                                  genre: selectedEvent.metadata?.display?.performance?.genre || [],
                                  duration_minutes: selectedEvent.metadata?.display?.performance?.duration_minutes || null,
                                  intermission: selectedEvent.metadata?.display?.performance?.intermission || false,
                                  age_limit: selectedEvent.metadata?.display?.performance?.age_limit || '전체관람가',
                                  showtimes: selectedEvent.metadata?.display?.performance?.showtimes || {},
                                  runtime: selectedEvent.metadata?.display?.performance?.runtime || null,
                                  crew: selectedEvent.metadata?.display?.performance?.crew || {
                                    director: null,
                                    writer: null,
                                    composer: null,
                                  },
                                  discounts: selectedEvent.metadata?.display?.performance?.discounts || [],
                                  last_admission: selectedEvent.metadata?.display?.performance?.last_admission || null,
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
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        장르 (쉼표로 구분)
                        {getFieldSourceBadge('metadata.display.performance.genre')}
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.metadata?.display?.performance?.genre?.join(', ') || ''}
                        onChange={(e) => {
                          const genre = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                performance: {
                                  ...selectedEvent.metadata?.display?.performance,
                                  cast: selectedEvent.metadata?.display?.performance?.cast || [],
                                  genre,
                                  duration_minutes: selectedEvent.metadata?.display?.performance?.duration_minutes || null,
                                  intermission: selectedEvent.metadata?.display?.performance?.intermission || false,
                                  age_limit: selectedEvent.metadata?.display?.performance?.age_limit || '전체관람가',
                                  showtimes: selectedEvent.metadata?.display?.performance?.showtimes || {},
                                  runtime: selectedEvent.metadata?.display?.performance?.runtime || null,
                                  crew: selectedEvent.metadata?.display?.performance?.crew || {
                                    director: null,
                                    writer: null,
                                    composer: null,
                                  },
                                  discounts: selectedEvent.metadata?.display?.performance?.discounts || [],
                                  last_admission: selectedEvent.metadata?.display?.performance?.last_admission || null,
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
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                          공연 시간 (분)
                          {getFieldSourceBadge('metadata.display.performance.duration_minutes')}
                        </label>
                        <input
                          type="number"
                          value={selectedEvent.metadata?.display?.performance?.duration_minutes || ''}
                          onChange={(e) => {
                            setSelectedEvent({
                              ...selectedEvent,
                              metadata: {
                                ...selectedEvent.metadata,
                                display: {
                                  ...selectedEvent.metadata?.display,
                                  performance: {
                                    ...selectedEvent.metadata?.display?.performance,
                                    cast: selectedEvent.metadata?.display?.performance?.cast || [],
                                    genre: selectedEvent.metadata?.display?.performance?.genre || [],
                                    duration_minutes: parseInt(e.target.value) || null,
                                    intermission: selectedEvent.metadata?.display?.performance?.intermission || false,
                                    age_limit: selectedEvent.metadata?.display?.performance?.age_limit || '전체관람가',
                                    showtimes: selectedEvent.metadata?.display?.performance?.showtimes || {},
                                    runtime: selectedEvent.metadata?.display?.performance?.runtime || null,
                                    crew: selectedEvent.metadata?.display?.performance?.crew || {
                                      director: null,
                                      writer: null,
                                      composer: null,
                                    },
                                    discounts: selectedEvent.metadata?.display?.performance?.discounts || [],
                                    last_admission: selectedEvent.metadata?.display?.performance?.last_admission || null,
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
                            checked={selectedEvent.metadata?.display?.performance?.intermission || false}
                            onChange={(e) => {
                              setSelectedEvent({
                                ...selectedEvent,
                                metadata: {
                                  ...selectedEvent.metadata,
                                  display: {
                                    ...selectedEvent.metadata?.display,
                                    performance: {
                                      ...selectedEvent.metadata?.display?.performance,
                                      cast: selectedEvent.metadata?.display?.performance?.cast || [],
                                      genre: selectedEvent.metadata?.display?.performance?.genre || [],
                                      duration_minutes: selectedEvent.metadata?.display?.performance?.duration_minutes || null,
                                      intermission: e.target.checked,
                                      age_limit: selectedEvent.metadata?.display?.performance?.age_limit || '전체관람가',
                                      showtimes: selectedEvent.metadata?.display?.performance?.showtimes || {},
                                      runtime: selectedEvent.metadata?.display?.performance?.runtime || null,
                                      crew: selectedEvent.metadata?.display?.performance?.crew || {
                                        director: null,
                                        writer: null,
                                        composer: null,
                                      },
                                      discounts: selectedEvent.metadata?.display?.performance?.discounts || [],
                                      last_admission: selectedEvent.metadata?.display?.performance?.last_admission || null,
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
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        연령 제한
                        {getFieldSourceBadge('metadata.display.performance.age_limit')}
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.metadata?.display?.performance?.age_limit || ''}
                        onChange={(e) => {
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                performance: {
                                  ...selectedEvent.metadata?.display?.performance,
                                  cast: selectedEvent.metadata?.display?.performance?.cast || [],
                                  genre: selectedEvent.metadata?.display?.performance?.genre || [],
                                  duration_minutes: selectedEvent.metadata?.display?.performance?.duration_minutes || null,
                                  intermission: selectedEvent.metadata?.display?.performance?.intermission || false,
                                  age_limit: e.target.value || '전체관람가',
                                  showtimes: selectedEvent.metadata?.display?.performance?.showtimes || {},
                                  runtime: selectedEvent.metadata?.display?.performance?.runtime || null,
                                  crew: selectedEvent.metadata?.display?.performance?.crew || {
                                    director: null,
                                    writer: null,
                                    composer: null,
                                  },
                                  discounts: selectedEvent.metadata?.display?.performance?.discounts || [],
                                  last_admission: selectedEvent.metadata?.display?.performance?.last_admission || null,
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
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        할인 정보 (쉼표로 구분)
                        {getFieldSourceBadge('metadata.display.performance.discounts')}
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.metadata?.display?.performance?.discounts?.join(', ') || ''}
                        onChange={(e) => {
                          const discounts = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                performance: {
                                  ...selectedEvent.metadata?.display?.performance,
                                  cast: selectedEvent.metadata?.display?.performance?.cast || [],
                                  genre: selectedEvent.metadata?.display?.performance?.genre || [],
                                  duration_minutes: selectedEvent.metadata?.display?.performance?.duration_minutes || null,
                                  intermission: selectedEvent.metadata?.display?.performance?.intermission || false,
                                  age_limit: selectedEvent.metadata?.display?.performance?.age_limit || '전체관람가',
                                  showtimes: selectedEvent.metadata?.display?.performance?.showtimes || {},
                                  runtime: selectedEvent.metadata?.display?.performance?.runtime || null,
                                  crew: selectedEvent.metadata?.display?.performance?.crew || {
                                    director: null,
                                    writer: null,
                                    composer: null,
                                  },
                                  discounts,
                                  last_admission: selectedEvent.metadata?.display?.performance?.last_admission || null,
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

              {/* 🏪 팝업 특화 정보 (F&B 강화) */}
              {selectedEvent.main_category === '팝업' && (
                <section>
                  <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🏪 팝업 특화 정보</h4>
                  <div className="space-y-4">
                    {/* 브랜드 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        브랜드 (쉼표로 구분)
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.metadata?.display?.popup?.brands?.join(', ') || ''}
                        onChange={(e) => {
                          const brands = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                popup: {
                                  ...selectedEvent.metadata?.display?.popup,
                                  brands,
                                  is_fnb: selectedEvent.metadata?.display?.popup?.is_fnb || false,
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
                            checked={selectedEvent.metadata?.display?.popup?.type === 'fnb'}
                            onChange={(e) => {
                              setSelectedEvent({
                                ...selectedEvent,
                                metadata: {
                                  ...selectedEvent.metadata,
                                  display: {
                                    ...selectedEvent.metadata?.display,
                                    popup: {
                                      ...selectedEvent.metadata?.display?.popup,
                                      type: 'fnb',
                                      brands: selectedEvent.metadata?.display?.popup?.brands || [],
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
                            checked={selectedEvent.metadata?.display?.popup?.type === 'collab'}
                            onChange={(e) => {
                              setSelectedEvent({
                                ...selectedEvent,
                                metadata: {
                                  ...selectedEvent.metadata,
                                  display: {
                                    ...selectedEvent.metadata?.display,
                                    popup: {
                                      ...selectedEvent.metadata?.display?.popup,
                                      type: 'collab',
                                      brands: selectedEvent.metadata?.display?.popup?.brands || [],
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
                            checked={selectedEvent.metadata?.display?.popup?.type === 'general' || !selectedEvent.metadata?.display?.popup?.type}
                            onChange={(e) => {
                              setSelectedEvent({
                                ...selectedEvent,
                                metadata: {
                                  ...selectedEvent.metadata,
                                  display: {
                                    ...selectedEvent.metadata?.display,
                                    popup: {
                                      ...selectedEvent.metadata?.display?.popup,
                                      type: 'general',
                                      brands: selectedEvent.metadata?.display?.popup?.brands || [],
                                    },
                                  },
                                },
                              });
                            }}
                          />
                          <span className="text-sm font-medium">📦 일반 팝업</span>
                        </label>
                      </div>
                      {getFieldSourceBadge('metadata.display.popup.type')}
                    </div>

                    {/* ⭐ 콜라보 설명 (type === 'collab'일 때만) */}
                    {selectedEvent.metadata?.display?.popup?.type === 'collab' && (
                      <div className="ml-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                        <h5 className="font-semibold mb-3 text-sm">🤝 콜라보 정보</h5>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            콜라보 설명
                          </label>
                          <textarea
                            value={selectedEvent.metadata?.display?.popup?.collab_description || ''}
                            onChange={(e) => {
                              setSelectedEvent({
                                ...selectedEvent,
                                metadata: {
                                  ...selectedEvent.metadata,
                                  display: {
                                    ...selectedEvent.metadata?.display,
                                    popup: {
                                      ...selectedEvent.metadata?.display?.popup,
                                      type: 'collab',
                                      collab_description: e.target.value,
                                      brands: selectedEvent.metadata?.display?.popup?.brands || [],
                                    },
                                  },
                                },
                              });
                            }}
                            className="textarea textarea-bordered w-full text-sm"
                            rows={3}
                            placeholder="예: 노티드와 산리오 캐릭터즈의 첫 공식 콜라보레이션"
                          />
                          {getFieldSourceBadge('metadata.display.popup.collab_description')}
                        </div>
                      </div>
                    )}

                    {/* ⭐ F&B 정보 (type === 'fnb'일 때만) */}
                    {selectedEvent.metadata?.display?.popup?.type === 'fnb' && (
                      <div className="ml-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                        <h5 className="font-semibold mb-3 text-sm">🍰 메뉴 정보</h5>

                        {/* 시그니처 메뉴 */}
                        <div className="mb-3">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            ⭐ 시그니처 메뉴 (쉼표로 구분)
                          </label>
                          <input
                            type="text"
                            value={selectedEvent.metadata?.display?.popup?.fnb_items?.signature_menu?.join(', ') || ''}
                            onChange={(e) => {
                              const signature_menu = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                              setSelectedEvent({
                                ...selectedEvent,
                                metadata: {
                                  ...selectedEvent.metadata,
                                  display: {
                                    ...selectedEvent.metadata?.display,
                                    popup: {
                                      ...selectedEvent.metadata?.display?.popup,
                                      type: 'fnb',
                                      brands: selectedEvent.metadata?.display?.popup?.brands || [],
                                      fnb_items: {
                                        ...selectedEvent.metadata?.display?.popup?.fnb_items,
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
                            value={selectedEvent.metadata?.display?.popup?.fnb_items?.menu_categories?.join(', ') || ''}
                            onChange={(e) => {
                              const menu_categories = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                              setSelectedEvent({
                                ...selectedEvent,
                                metadata: {
                                  ...selectedEvent.metadata,
                                  display: {
                                    ...selectedEvent.metadata?.display,
                                    popup: {
                                      ...selectedEvent.metadata?.display?.popup,
                                      type: 'fnb',
                                      brands: selectedEvent.metadata?.display?.popup?.brands || [],
                                      fnb_items: {
                                        ...selectedEvent.metadata?.display?.popup?.fnb_items,
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
                            value={selectedEvent.metadata?.display?.popup?.fnb_items?.price_range || ''}
                            onChange={(e) => {
                              setSelectedEvent({
                                ...selectedEvent,
                                metadata: {
                                  ...selectedEvent.metadata,
                                  display: {
                                    ...selectedEvent.metadata?.display,
                                    popup: {
                                      ...selectedEvent.metadata?.display?.popup,
                                      type: 'fnb',
                                      brands: selectedEvent.metadata?.display?.popup?.brands || [],
                                      fnb_items: {
                                        ...selectedEvent.metadata?.display?.popup?.fnb_items,
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
                        value={selectedEvent.metadata?.display?.popup?.goods_items?.join(', ') || ''}
                        onChange={(e) => {
                          const goods_items = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                popup: {
                                  ...selectedEvent.metadata?.display?.popup,
                                  goods_items,
                                  is_fnb: selectedEvent.metadata?.display?.popup?.is_fnb || false,
                                  brands: selectedEvent.metadata?.display?.popup?.brands || [],
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
                          checked={selectedEvent.metadata?.display?.popup?.photo_zone || false}
                          onChange={(e) => {
                            setSelectedEvent({
                              ...selectedEvent,
                              metadata: {
                                ...selectedEvent.metadata,
                                display: {
                                  ...selectedEvent.metadata?.display,
                                  popup: {
                                    ...selectedEvent.metadata?.display?.popup,
                                    photo_zone: e.target.checked,
                                    is_fnb: selectedEvent.metadata?.display?.popup?.is_fnb || false,
                                    brands: selectedEvent.metadata?.display?.popup?.brands || [],
                                  },
                                },
                              },
                            });
                          }}
                        />
                        <span className="text-sm font-medium">포토존 있음</span>
                      </label>
                      
                      {/* 포토존 상세 설명 (포토존이 있을 때만 표시) */}
                      {selectedEvent.metadata?.display?.popup?.photo_zone && (
                        <div className="ml-6 mt-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                            포토존 상세 설명
                            {getFieldSourceBadge('metadata.display.popup.photo_zone_desc')}
                          </label>
                          <input
                            type="text"
                            value={selectedEvent.metadata?.display?.popup?.photo_zone_desc || ''}
                            onChange={(e) => handleMetadataDisplayChange('popup', 'photo_zone_desc', e.target.value)}
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
                        value={selectedEvent.metadata?.display?.popup?.waiting_hint?.level || ''}
                        onChange={(e) => {
                          const level = e.target.value as 'low' | 'medium' | 'high' | '';
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                popup: {
                                  ...selectedEvent.metadata?.display?.popup,
                                  waiting_hint: level ? {
                                    level,
                                    text: selectedEvent.metadata?.display?.popup?.waiting_hint?.text || '',
                                  } : undefined,
                                  is_fnb: selectedEvent.metadata?.display?.popup?.is_fnb || false,
                                  brands: selectedEvent.metadata?.display?.popup?.brands || [],
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
                      {selectedEvent.metadata?.display?.popup?.waiting_hint?.level && (
                        <div className="mt-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            대기 시간 상세 설명
                          </label>
                          <textarea
                            value={selectedEvent.metadata?.display?.popup?.waiting_hint?.text || ''}
                            onChange={(e) => {
                              setSelectedEvent({
                                ...selectedEvent,
                                metadata: {
                                  ...selectedEvent.metadata,
                                  display: {
                                    ...selectedEvent.metadata?.display,
                                    popup: {
                                      ...selectedEvent.metadata?.display?.popup,
                                      waiting_hint: {
                                        level: selectedEvent.metadata?.display?.popup?.waiting_hint?.level!,
                                        text: e.target.value,
                                      },
                                      is_fnb: selectedEvent.metadata?.display?.popup?.is_fnb || false,
                                      brands: selectedEvent.metadata?.display?.popup?.brands || [],
                                    },
                                  },
                                },
                              });
                            }}
                            className="textarea textarea-bordered w-full text-sm"
                            rows={2}
                            placeholder="예: 평일 오후는 대기 없음, 주말 오픈런 추천"
                          />
                          {getFieldSourceBadge('metadata.display.popup.waiting_hint')}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* 🎪 축제 특화 정보 */}
              {selectedEvent.main_category === '축제' && (
                <section>
                  <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🎪 축제 특화 정보</h4>
                  <div className="space-y-4">
                    {/* 주최/주관 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        주최/주관 기관
                        {getFieldSourceBadge('metadata.display.festival.organizer')}
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.metadata?.display?.festival?.organizer || ''}
                        onChange={(e) => {
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                festival: {
                                  ...selectedEvent.metadata?.display?.festival,
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
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        주요 프로그램
                        {getFieldSourceBadge('metadata.display.festival.program_highlights')}
                      </label>
                      <textarea
                        value={selectedEvent.metadata?.display?.festival?.program_highlights || ''}
                        onChange={(e) => {
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                festival: {
                                  ...selectedEvent.metadata?.display?.festival,
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
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        먹거리/체험 부스
                        {getFieldSourceBadge('metadata.display.festival.food_and_booths')}
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.metadata?.display?.festival?.food_and_booths || ''}
                        onChange={(e) => {
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                festival: {
                                  ...selectedEvent.metadata?.display?.festival,
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
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        규모
                        {getFieldSourceBadge('metadata.display.festival.scale_text')}
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.metadata?.display?.festival?.scale_text || ''}
                        onChange={(e) => {
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                festival: {
                                  ...selectedEvent.metadata?.display?.festival,
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
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        주차 정보
                        {getFieldSourceBadge('metadata.display.festival.parking_tips')}
                      </label>
                      <textarea
                        value={selectedEvent.metadata?.display?.festival?.parking_tips || ''}
                        onChange={(e) => {
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                festival: {
                                  ...selectedEvent.metadata?.display?.festival,
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

              {/* 📅 행사 특화 정보 */}
              {selectedEvent.main_category === '행사' && (
                <section>
                  <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">📅 행사 특화 정보</h4>
                  <div className="space-y-4">
                    {/* 참가 대상 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        참가 대상
                        {getFieldSourceBadge('metadata.display.event.target_audience')}
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.metadata?.display?.event?.target_audience || ''}
                        onChange={(e) => {
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                event: {
                                  ...selectedEvent.metadata?.display?.event,
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
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        정원
                        {getFieldSourceBadge('metadata.display.event.capacity')}
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.metadata?.display?.event?.capacity || ''}
                        onChange={(e) => {
                          setSelectedEvent({
                            ...selectedEvent,
                            metadata: {
                              ...selectedEvent.metadata,
                              display: {
                                ...selectedEvent.metadata?.display,
                                event: {
                                  ...selectedEvent.metadata?.display?.event,
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
                            checked={selectedEvent.metadata?.display?.event?.registration?.required || false}
                            onChange={(e) => {
                              setSelectedEvent({
                                ...selectedEvent,
                                metadata: {
                                  ...selectedEvent.metadata,
                                  display: {
                                    ...selectedEvent.metadata?.display,
                                    event: {
                                      ...selectedEvent.metadata?.display?.event,
                                      registration: {
                                        ...selectedEvent.metadata?.display?.event?.registration,
                                        required: e.target.checked,
                                      },
                                    },
                                  },
                                },
                              });
                            }}
                          />
                          <span className="text-sm font-medium">사전 등록 필요</span>
                          {getFieldSourceBadge('metadata.display.event.registration.required')}
                        </label>
                      </div>

                      {/* 등록 링크 */}
                      {selectedEvent.metadata?.display?.event?.registration?.required && (
                        <>
                          <div className="mb-3">
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                              등록 링크
                              {getFieldSourceBadge('metadata.display.event.registration.url')}
                            </label>
                            <input
                              type="url"
                              value={selectedEvent.metadata?.display?.event?.registration?.url || ''}
                              onChange={(e) => {
                                setSelectedEvent({
                                  ...selectedEvent,
                                  metadata: {
                                    ...selectedEvent.metadata,
                                    display: {
                                      ...selectedEvent.metadata?.display,
                                      event: {
                                        ...selectedEvent.metadata?.display?.event,
                                        registration: {
                                          ...selectedEvent.metadata?.display?.event?.registration,
                                          required: true,
                                          url: e.target.value,
                                        },
                                      },
                                    },
                                  },
                                });
                              }}
                              className="input text-sm"
                              placeholder="https://forms.gle/..."
                            />
                          </div>

                          {/* 등록 마감일 */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                              등록 마감일
                              {getFieldSourceBadge('metadata.display.event.registration.deadline')}
                            </label>
                            <input
                              type="date"
                              value={selectedEvent.metadata?.display?.event?.registration?.deadline || ''}
                              onChange={(e) => {
                                setSelectedEvent({
                                  ...selectedEvent,
                                  metadata: {
                                    ...selectedEvent.metadata,
                                    display: {
                                      ...selectedEvent.metadata?.display,
                                      event: {
                                        ...selectedEvent.metadata?.display?.event,
                                        registration: {
                                          ...selectedEvent.metadata?.display?.event?.registration,
                                          required: true,
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

              {/* 일정 */}
              <section>
                <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">📅 일정</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                      시작일 *
                      {getFieldSourceBadge('start_at')}
                    </label>
                    <input
                      type="date"
                      value={selectedEvent.start_at?.split('T')[0] || ''}
                      onChange={(e) =>
                        setSelectedEvent({ ...selectedEvent, start_at: e.target.value })
                      }
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                      종료일
                      {getFieldSourceBadge('end_at')}
                    </label>
                    <input
                      type="date"
                      value={selectedEvent.end_at?.split('T')[0] || ''}
                      onChange={(e) =>
                        setSelectedEvent({ ...selectedEvent, end_at: e.target.value })
                      }
                      className="input"
                    />
                  </div>
                  <div className="col-span-2">
                    <div className="bg-gray-50 p-3 rounded text-sm text-gray-600">
                      {selectedEvent.is_ending_soon ? (
                        <span className="text-red-600 font-medium">⚠️ 곧 종료됩니다 (7일 이내)</span>
                      ) : (
                        <span className="text-green-600">✓ 종료까지 충분한 시간이 있습니다</span>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* 위치 */}
              <section>
                <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">📍 위치</h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                      장소 *
                      {getFieldSourceBadge('venue')}
                    </label>
                    <input
                      type="text"
                      value={selectedEvent.venue || ''}
                      onChange={(e) => {
                        setSelectedEvent({ 
                          ...selectedEvent, 
                          venue: e.target.value,
                          // 장소가 변경되면 좌표를 초기화하여 백엔드가 다시 지오코딩하도록 함
                          lat: null,
                          lng: null,
                          region: null,
                        });
                      }}
                      className="input"
                      placeholder="예: 잠실 롯데월드타워"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                      주소
                      {getFieldSourceBadge('address')}
                    </label>
                    <input
                      type="text"
                      value={selectedEvent.address || ''}
                      onChange={(e) => {
                        setSelectedEvent({ 
                          ...selectedEvent, 
                          address: e.target.value,
                          // 주소가 변경되면 좌표를 초기화하여 백엔드가 다시 지오코딩하도록 함
                          lat: null,
                          lng: null,
                          region: null,
                        });
                      }}
                      className="input"
                      placeholder="예: 서울 강남구 테헤란로 521"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      💡 주소나 장소를 변경하면 저장 시 자동으로 위도/경도/지역이 채워집니다
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        지역 (자동)
                        {getFieldSourceBadge('region')}
                      </label>
                      <input
                        type="text"
                        value={selectedEvent.region || (selectedEvent.lat ? '-' : '저장 시 자동 채워짐')}
                        className="input bg-gray-50"
                        disabled
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">위도 (자동)</label>
                      <input
                        type="text"
                        value={selectedEvent.lat || (selectedEvent.address || selectedEvent.venue ? '저장 시 자동 채워짐' : '-')}
                        className="input bg-gray-50"
                        disabled
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">경도 (자동)</label>
                      <input
                        type="text"
                        value={selectedEvent.lng || (selectedEvent.address || selectedEvent.venue ? '저장 시 자동 채워짐' : '-')}
                        className="input bg-gray-50"
                        disabled
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* 이미지 */}
              <section>
                <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🖼️ 이미지</h4>
                
                {/* 이미지 없음 경고 */}
                {isPlaceholderImage(selectedEvent.image_url) && (
                  <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex items-start">
                      <span className="text-2xl mr-3">⚠️</span>
                      <div>
                        <p className="font-semibold text-yellow-800">이미지가 없습니다</p>
                        <p className="text-sm text-yellow-700 mt-1">
                          이 이벤트는 placeholder 이미지를 사용 중입니다. 실제 이미지를 업로드해주세요.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* 이미지 업로드 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    📸 이미지 업로드
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={isUploading}
                      className="flex-1 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-50"
                    />
                  </div>
                  {isUploading && (
                    <div className="mt-2">
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
                  <p className="mt-2 text-xs text-gray-500">
                    JPG, PNG 형식 / 최대 5MB / WebP로 자동 변환
                  </p>
                </div>

                {/* 이미지 URL 직접 입력 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                    또는 이미지 URL 직접 입력
                    {getFieldSourceBadge('image_url')}
                  </label>
                  <input
                    type="url"
                    value={selectedEvent.image_url || ''}
                    onChange={(e) =>
                      setSelectedEvent({ ...selectedEvent, image_url: e.target.value })
                    }
                    className="input"
                    placeholder="https://..."
                  />
                </div>

                {/* 이미지 미리보기 */}
                {selectedEvent.image_url && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">미리보기</label>
                    <img
                      src={selectedEvent.image_url}
                      alt="Preview"
                      className="w-full h-48 object-cover rounded-lg border"
                      onError={(e) => {
                        e.currentTarget.src = 'https://via.placeholder.com/400x300?text=Image+Not+Found';
                      }}
                    />
                  </div>
                )}
              </section>

              {/* 가격 */}
              <section>
                <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">💰 가격 정보</h4>
                <div className="space-y-4">
                  <div>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedEvent.is_free || false}
                        onChange={(e) =>
                          setSelectedEvent({ ...selectedEvent, is_free: e.target.checked })
                        }
                        className="mr-2 h-5 w-5"
                      />
                      <span className="font-medium">무료 이벤트</span>
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                      가격 상세
                      {getFieldSourceBadge('price_info')}
                    </label>
                    <input
                      type="text"
                      value={selectedEvent.price_info || ''}
                      onChange={(e) =>
                        setSelectedEvent({ ...selectedEvent, price_info: e.target.value })
                      }
                      className="input"
                      placeholder="예: 성인 15,000원, 청소년 10,000원"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        최소 가격 (원)
                        {getFieldSourceBadge('price_min')}
                      </label>
                      <input
                        type="number"
                        value={selectedEvent.price_min || ''}
                        onChange={(e) =>
                          setSelectedEvent({ 
                            ...selectedEvent, 
                            price_min: e.target.value ? parseInt(e.target.value) : null 
                          })
                        }
                        className="input"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                        최대 가격 (원)
                        {getFieldSourceBadge('price_max')}
                      </label>
                      <input
                        type="number"
                        value={selectedEvent.price_max || ''}
                        onChange={(e) =>
                          setSelectedEvent({ 
                            ...selectedEvent, 
                            price_max: e.target.value ? parseInt(e.target.value) : null 
                          })
                        }
                        className="input"
                        placeholder="100000"
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* 추가 정보 (Phase 1 공통 필드) */}
              <section>
                <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🔗 추가 정보</h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      상태 (자동 계산)
                    </label>
                    <input
                      type="text"
                      value={selectedEvent.status || 'unknown'}
                      className="input bg-gray-50"
                      disabled
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      scheduled(예정) | ongoing(진행중) | ended(종료)
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                      공식 홈페이지
                      {getFieldSourceBadge('external_links.official')}
                    </label>
                    <input
                      type="url"
                      value={selectedEvent.external_links?.official || ''}
                      onChange={(e) =>
                        setSelectedEvent({
                          ...selectedEvent,
                          external_links: { ...selectedEvent.external_links, official: e.target.value },
                        })
                      }
                      className="input"
                      placeholder="https://example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                      예매/티켓 링크
                      {getFieldSourceBadge('external_links.ticket')}
                    </label>
                    <input
                      type="url"
                      value={selectedEvent.external_links?.ticket || ''}
                      onChange={(e) =>
                        setSelectedEvent({
                          ...selectedEvent,
                          external_links: { ...selectedEvent.external_links, ticket: e.target.value },
                        })
                      }
                      className="input"
                      placeholder="https://tickets.example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">예약 링크</label>
                    <input
                      type="url"
                      value={selectedEvent.external_links?.reservation || ''}
                      onChange={(e) =>
                        setSelectedEvent({
                          ...selectedEvent,
                          external_links: { ...selectedEvent.external_links, reservation: e.target.value },
                        })
                      }
                      className="input"
                      placeholder="https://reservation.example.com"
                    />
                  </div>

                  {/* 팝업일 때만 인스타그램 URL */}
                  {selectedEvent.main_category === '팝업' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">📸 Instagram URL</label>
                      <input
                        type="url"
                        value={selectedEvent.external_links?.instagram || ''}
                        onChange={(e) =>
                          setSelectedEvent({
                            ...selectedEvent,
                            external_links: { ...selectedEvent.external_links, instagram: e.target.value },
                          })
                        }
                        className="input"
                        placeholder="https://instagram.com/p/..."
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">원본 태그 (Source Tags)</label>
                    <input
                      type="text"
                      value={selectedEvent.source_tags?.join(', ') || ''}
                      onChange={(e) =>
                        setSelectedEvent({
                          ...selectedEvent,
                          source_tags: e.target.value.split(',').map(t => t.trim()).filter(t => t !== ''),
                        })
                      }
                      className="input"
                      placeholder="예: 공연, 전시, 축제"
                    />
                    <p className="mt-1 text-xs text-gray-500">원본 데이터의 태그 (쉼표로 구분)</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      🤖 AI 추천 태그 (Derived Tags) {getFieldSourceBadge('derived_tags')}
                    </label>
                    {selectedEvent.derived_tags && selectedEvent.derived_tags.length > 0 ? (
                      <div className="flex flex-wrap gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        {selectedEvent.derived_tags.map((tag, idx) => (
                          <span
                            key={idx}
                            className="px-3 py-1 bg-blue-500 text-white text-sm rounded-full flex items-center gap-2"
                          >
                            {tag}
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedEvent({
                                  ...selectedEvent,
                                  derived_tags: selectedEvent.derived_tags?.filter((_, i) => i !== idx),
                                })
                              }
                              className="text-white hover:text-blue-200"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 italic p-3 bg-gray-50 rounded-lg">
                        AI 태그가 없습니다. "AI로 정보 보완"을 클릭하여 자동 생성할 수 있습니다.
                      </p>
                    )}
                    <p className="mt-2 text-xs text-gray-500">
                      태그를 클릭하여 삭제할 수 있습니다 (수정 후 저장 필요)
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      🕐 운영 시간 (Opening Hours) {getFieldSourceBadge('opening_hours')}
                    </label>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">평일</label>
                        <input
                          type="text"
                          value={selectedEvent.opening_hours?.weekday || ''}
                          onChange={(e) =>
                            setSelectedEvent({
                              ...selectedEvent,
                              opening_hours: { ...selectedEvent.opening_hours, weekday: e.target.value },
                            })
                          }
                          className="input text-sm"
                          placeholder="예: 10:00-20:00"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">주말</label>
                        <input
                          type="text"
                          value={selectedEvent.opening_hours?.weekend || ''}
                          onChange={(e) =>
                            setSelectedEvent({
                              ...selectedEvent,
                              opening_hours: { ...selectedEvent.opening_hours, weekend: e.target.value },
                            })
                          }
                          className="input text-sm"
                          placeholder="예: 10:00-22:00"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">공휴일</label>
                        <input
                          type="text"
                          value={selectedEvent.opening_hours?.holiday || ''}
                          onChange={(e) =>
                            setSelectedEvent({
                              ...selectedEvent,
                              opening_hours: { ...selectedEvent.opening_hours, holiday: e.target.value },
                            })
                          }
                          className="input text-sm"
                          placeholder="예: 10:00-18:00"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">휴무일</label>
                        <input
                          type="text"
                          value={selectedEvent.opening_hours?.closed || ''}
                          onChange={(e) =>
                            setSelectedEvent({
                              ...selectedEvent,
                              opening_hours: { ...selectedEvent.opening_hours, closed: e.target.value },
                            })
                          }
                          className="input text-sm"
                          placeholder="예: 월요일"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">추가 정보</label>
                        <input
                          type="text"
                          value={selectedEvent.opening_hours?.notes || ''}
                          onChange={(e) =>
                            setSelectedEvent({
                              ...selectedEvent,
                              opening_hours: { ...selectedEvent.opening_hours, notes: e.target.value },
                            })
                          }
                          className="input text-sm"
                          placeholder="예: 공연 시작 시간 등"
                        />
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      AI가 분석한 운영 시간을 수동으로 수정할 수 있습니다
                    </p>
                  </div>

                  {/* 🚗 주차 정보 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      🚗 주차 정보 (Parking) {getFieldSourceBadge('parking_available')}
                    </label>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">주차 가능 여부</label>
                        <select
                          value={
                            selectedEvent.parking_available === null || selectedEvent.parking_available === undefined
                              ? 'null'
                              : selectedEvent.parking_available
                              ? 'true'
                              : 'false'
                          }
                          onChange={(e) => {
                            const value = e.target.value === 'null' ? null : e.target.value === 'true';
                            setSelectedEvent({
                              ...selectedEvent,
                              parking_available: value,
                            });
                          }}
                          className="input text-sm"
                        >
                          <option value="null">정보 없음</option>
                          <option value="true">주차 가능</option>
                          <option value="false">주차 불가</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">주차 상세 정보 {getFieldSourceBadge('parking_info')}</label>
                        <textarea
                          value={selectedEvent.parking_info || ''}
                          onChange={(e) =>
                            setSelectedEvent({
                              ...selectedEvent,
                              parking_info: e.target.value,
                            })
                          }
                          className="input text-sm"
                          placeholder="예: 건물 지하 주차장 이용 가능, 1시간 무료"
                          rows={2}
                        />
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      AI가 분석한 주차 정보를 수동으로 수정할 수 있습니다
                    </p>
                  </div>

                  {selectedEvent.quality_flags && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">데이터 품질</label>
                      <div className="flex flex-wrap gap-2">
                        {selectedEvent.quality_flags.has_real_image && (
                          <span className="badge badge-green text-xs">✅ 실제 이미지</span>
                        )}
                        {selectedEvent.quality_flags.has_exact_address && (
                          <span className="badge badge-green text-xs">✅ 주소 있음</span>
                        )}
                        {selectedEvent.quality_flags.geo_ok && (
                          <span className="badge badge-green text-xs">✅ 좌표 있음</span>
                        )}
                        {selectedEvent.quality_flags.has_overview && (
                          <span className="badge badge-green text-xs">✅ 설명 있음</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* 점수 */}
              <section>
                <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">📊 점수</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      인기도 (Popularity Score)
                    </label>
                    <input
                      type="number"
                      value={selectedEvent.popularity_score || 0}
                      onChange={(e) =>
                        setSelectedEvent({
                          ...selectedEvent,
                          popularity_score: parseInt(e.target.value) || 0,
                        })
                      }
                      className="input"
                      min="0"
                      max="1000"
                    />
                    <p className="text-xs text-gray-500 mt-1">0~1000 (큐레이션 점수)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">
                      버즈 스코어 (자동)
                    </label>
                    <input
                      type="number"
                      value={selectedEvent.buzz_score || 0}
                      className="input bg-gray-50"
                      disabled
                    />
                    <p className="text-xs text-gray-500 mt-1">조회수/참여도 기반 자동 계산</p>
                  </div>
                </div>
              </section>

              {/* Featured */}
              <section>
                <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">⭐ Featured</h4>
                <div className="space-y-4">
                  <div>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedEvent.is_featured || false}
                        onChange={(e) =>
                          setSelectedEvent({ ...selectedEvent, is_featured: e.target.checked })
                        }
                        className="mr-2 h-5 w-5"
                      />
                      <span className="font-medium">Featured 이벤트로 지정</span>
                    </label>
                  </div>
                  {selectedEvent.is_featured && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Featured 순서
                        </label>
                        <input
                          type="number"
                          value={selectedEvent.featured_order || ''}
                          onChange={(e) =>
                            setSelectedEvent({
                              ...selectedEvent,
                              featured_order: parseInt(e.target.value) || null,
                            })
                          }
                          className="input"
                          placeholder="1, 2, 3..."
                        />
                      </div>
                      {selectedEvent.featured_at && (
                        <div className="bg-purple-50 p-3 rounded text-sm">
                          <span className="text-gray-600">Featured 지정 시각:</span>{' '}
                          <span className="font-medium">
                            {new Date(selectedEvent.featured_at).toLocaleString('ko-KR')}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>

              {/* AI 태그 */}
              {selectedEvent.tags_context && (
                <section>
                  <h4 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">🤖 AI 생성 태그</h4>
                  <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-4 rounded-lg">
                    <pre className="text-xs text-gray-700 overflow-x-auto">
                      {JSON.stringify(selectedEvent.tags_context, null, 2)}
                    </pre>
                  </div>
                </section>
              )}

              {/* 메타데이터 */}
              <section>
                <h4 className="text-lg font-bold text-gray-500 mb-4 pb-2 border-b">🔧 메타데이터 (읽기 전용)</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2">
                    <span className="text-gray-500">ID:</span>
                    <code className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded">{selectedEvent.id}</code>
                  </div>
                  {selectedEvent.content_key && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Content Key:</span>
                      <code className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded">
                        {selectedEvent.content_key}
                      </code>
                    </div>
                  )}
                  <div>
                    <span className="text-gray-500">생성일:</span>{' '}
                    {new Date(selectedEvent.created_at).toLocaleString('ko-KR')}
                  </div>
                  <div>
                    <span className="text-gray-500">수정일:</span>{' '}
                    {new Date(selectedEvent.updated_at).toLocaleString('ko-KR')}
                  </div>
                  {selectedEvent.metadata && (
                    <div className="col-span-2">
                      <details className="cursor-pointer">
                        <summary className="text-gray-500 font-medium">Metadata JSON</summary>
                        <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                          {JSON.stringify(selectedEvent.metadata, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              </section>

              {/* 버튼 그룹 */}
              <div className="space-y-2">
                {/* 저장 버튼 */}
                <button onClick={() => handleSaveEvent(false)} className="btn-primary w-full sticky bottom-0">
                  💾 변경사항 저장
                </button>

                {/* 삭제 버튼 */}
                <button
                  onClick={handleDeleteEvent}
                  className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                >
                  🗑️ 이벤트 삭제
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

