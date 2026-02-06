import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getHotSuggestions, rejectHotSuggestion } from '../services/api';
import EventForm from '../components/EventForm';

interface HotSuggestion {
  id: string;
  title: string;
  venue?: string;
  region?: string;
  link: string;
  description: string;
  overview: string;
  source: 'blog' | 'web' | 'cafe';
  postdate?: string;
  candidate_score: number;
  evidence_links: string[]; // 🆕 증거 링크 배열
  evidence_count: number;   // 🆕 증거 개수
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export default function HotSuggestionsPage() {
  const [selectedStatus, setSelectedStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  
  const queryClient = useQueryClient();

  // Hot Suggestions 조회
  const { data, isLoading, error } = useQuery({
    queryKey: ['hotSuggestions', selectedStatus],
    queryFn: () => getHotSuggestions(selectedStatus),
  });

  // 거부 Mutation
  const rejectMutation = useMutation({
    mutationFn: rejectHotSuggestion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotSuggestions'] });
      alert('거부되었습니다.');
    },
    onError: (error: any) => {
      alert(`거부 실패: ${error.message}`);
    },
  });

  const handleApprove = (suggestion: HotSuggestion) => {
    setApprovingId(suggestion.id);
  };

  const handleCancelApprove = () => {
    setApprovingId(null);
  };

  const handleSuccessApprove = () => {
    queryClient.invalidateQueries({ queryKey: ['hotSuggestions'] });
    setApprovingId(null);
    alert('✅ 이벤트가 생성되고 승인되었습니다!');
  };

  const handleReject = (id: string) => {
    if (confirm('정말 거부하시겠습니까?')) {
      rejectMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-600">오류가 발생했습니다: {(error as Error).message}</p>
      </div>
    );
  }

  const suggestions: HotSuggestion[] = data?.items || [];

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🔥 Hot Suggestions</h1>
          <p className="text-sm text-gray-500 mt-1">
            AI가 자동 발굴한 핫한 이벤트 후보 ({suggestions.length}개)
          </p>
        </div>

        {/* 상태 필터 */}
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedStatus('pending')}
            className={`px-4 py-2 rounded-lg ${
              selectedStatus === 'pending'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            대기 중
          </button>
          <button
            onClick={() => setSelectedStatus('approved')}
            className={`px-4 py-2 rounded-lg ${
              selectedStatus === 'approved'
                ? 'bg-green-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            승인됨
          </button>
          <button
            onClick={() => setSelectedStatus('rejected')}
            className={`px-4 py-2 rounded-lg ${
              selectedStatus === 'rejected'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            거부됨
          </button>
        </div>
      </div>

      {/* Suggestions 목록 */}
      <div className="grid gap-4">
        {suggestions.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <p className="text-gray-500">표시할 항목이 없습니다.</p>
          </div>
        ) : (
          suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
            >
              {/* 승인 폼 (CreateEventPage와 동일한 전체 폼) */}
              {approvingId === suggestion.id ? (
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">🔥 Hot Suggestion 승인</h3>
                  <EventForm
                    initialData={{
                      title: suggestion.title,
                      venue: suggestion.venue,
                      region: suggestion.region,
                      overview: suggestion.description,
                      imageSourcePageUrl: suggestion.evidence_links?.[0],
                      externalLinks: {
                        official: suggestion.evidence_links?.[0] || '',
                        ticket: '',
                        instagram: '',
                        reservation: '',
                      },
                    }}
                    hotSuggestionId={suggestion.id}
                    onSuccess={handleSuccessApprove}
                    onCancel={handleCancelApprove}
                  />
                </div>
              ) : (
                /* 기본 표시 */
                <>
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-semibold rounded">
                          {suggestion.candidate_score}점
                        </span>
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                          {suggestion.source === 'blog' ? '블로그' : suggestion.source === 'cafe' ? '카페' : '웹'}
                        </span>
                        {/* 🆕 증거 개수 표시 */}
                        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">
                          🔗 증거 {suggestion.evidence_count}개
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-1">{suggestion.title}</h3>
                      <div className="text-sm text-gray-600 space-y-1">
                        {suggestion.venue && <div>📍 {suggestion.venue}</div>}
                        {suggestion.region && <div>🗺️ {suggestion.region}</div>}
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-gray-600 mb-4">{suggestion.description}</p>

                  {/* 🆕 증거 링크 섹션 */}
                  {suggestion.evidence_links && suggestion.evidence_links.length > 0 && (
                    <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                      <div className="text-sm font-medium text-gray-700 mb-2">
                        🔍 증거 링크 ({suggestion.evidence_links.length}개)
                      </div>
                      <div className="space-y-1">
                        {suggestion.evidence_links.slice(0, 5).map((link, idx) => (
                          <a
                            key={idx}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline block truncate"
                          >
                            {idx + 1}. {link}
                          </a>
                        ))}
                        {suggestion.evidence_links.length > 5 && (
                          <div className="text-xs text-gray-500">
                            ... 외 {suggestion.evidence_links.length - 5}개 더
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 대표 원본 보기 (있을 경우만) */}
                  {suggestion.link && suggestion.link.trim() !== '' ? (
                    <a
                      href={suggestion.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline mb-4 block"
                    >
                      🔗 대표 원본 보기
                    </a>
                  ) : (
                    <a
                      href={`https://search.naver.com/search.naver?query=${encodeURIComponent(suggestion.title + ' 팝업')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-purple-600 hover:underline mb-4 block"
                    >
                      🔍 네이버에서 검색
                    </a>
                  )}

                  {selectedStatus === 'pending' && (
                    <div className="flex gap-2 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => handleApprove(suggestion)}
                        className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                      >
                        ✅ 승인
                      </button>
                      <button
                        onClick={() => handleReject(suggestion.id)}
                        disabled={rejectMutation.isPending}
                        className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
                      >
                        ❌ 거부
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

