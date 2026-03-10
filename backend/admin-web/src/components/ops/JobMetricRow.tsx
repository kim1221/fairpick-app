interface MetricItem {
  label: string;
  value: number;
  colorClass?: string;
}

interface JobMetricRowProps {
  items: MetricItem[];
}

export default function JobMetricRow({ items }: JobMetricRowProps) {
  return (
    <div
      className="grid gap-2 bg-gray-50 rounded-lg p-3 text-center"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div key={item.label}>
          <div className="text-[10px] text-gray-400 mb-0.5 uppercase">{item.label}</div>
          <div className={`text-base font-semibold tabular-nums ${item.colorClass ?? 'text-gray-700'}`}>
            {item.value.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}
