import { useState } from 'react';

interface RunNowButtonProps {
  jobName: string;
  jobLabel: string;
  onRun: (jobName: string) => Promise<void>;
  disabled?: boolean;
  /** 'primary' = 채워진 버튼, 'ghost' = 테두리 버튼 */
  variant?: 'primary' | 'ghost';
}

export default function RunNowButton({
  jobName,
  jobLabel,
  onRun,
  disabled = false,
  variant = 'primary',
}: RunNowButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    void handleConfirm();
  };

  const handleConfirm = async () => {
    setLoading(true);
    setConfirming(false);
    try {
      await onRun(jobName);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-orange-700 font-medium">
          「{jobLabel}」 실행?
        </span>
        <button
          onClick={handleClick}
          className="text-xs px-2.5 py-1 bg-orange-500 text-white rounded-md font-medium hover:bg-orange-600 transition-colors"
        >
          확인
        </button>
        <button
          onClick={handleCancel}
          className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700 transition-colors"
        >
          취소
        </button>
      </div>
    );
  }

  const base =
    'inline-flex items-center gap-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const style =
    variant === 'primary'
      ? 'px-3 py-1.5 bg-primary-600 text-white hover:bg-primary-700'
      : 'px-2.5 py-1.5 text-primary-600 hover:bg-primary-50 border border-primary-200';

  return (
    <button
      onClick={handleClick}
      disabled={disabled || loading}
      className={`${base} ${style}`}
    >
      {loading ? (
        <>
          <span className="animate-spin w-3 h-3 border border-current border-t-transparent rounded-full" />
          실행 중…
        </>
      ) : (
        <>▶ 지금 실행</>
      )}
    </button>
  );
}
