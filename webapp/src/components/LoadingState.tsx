interface LoadingStateProps {
  lines?: number;
  compact?: boolean;
  card?: boolean;
  className?: string;
}

export default function LoadingState(props: LoadingStateProps) {
  const lines = Math.max(1, props.lines || 4);
  return (
    <div className={`${props.card ? 'loading-state-card card' : 'loading-state'}${props.compact ? ' compact' : ''}${props.className ? ` ${props.className}` : ''}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="loading-state-row">
          <div className="loading-state-icon shimmer" />
          <div className="loading-state-text">
            <div className="loading-state-line shimmer" />
            <div className="loading-state-line short shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}
