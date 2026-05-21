import { cn } from '@/lib/utils';

interface StampedNumberProps {
  value: number | string;
  label?: string;
  className?: string;
  tone?: 'ink' | 'accent';
  animate?: boolean;
}

export function StampedNumber({
  value,
  label,
  className,
  tone = 'accent',
  animate = true,
}: StampedNumberProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      {label ? (
        <span className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          {label}
        </span>
      ) : null}
      <span
        className={cn(
          'font-display text-[96px] sm:text-[140px] md:text-[180px] leading-none tabular',
          tone === 'accent' ? 'text-accent' : 'text-ink',
          animate && 'animate-stamp-impact',
        )}
        style={{ textShadow: '4px 4px 0 hsl(var(--ink))' }}
      >
        {value}
      </span>
    </div>
  );
}
