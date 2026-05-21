import { cn } from '@/lib/utils';

interface ReferenceFaceProps {
  size?: 'sm' | 'md' | 'lg';
  caption?: string | null;
  className?: string;
}

const sizes = {
  sm: { box: 'h-20 w-20', img: 'h-14 w-14' },
  // md shrinks on mobile so the results card fits a single screen
  md: { box: 'h-24 w-24 sm:h-36 sm:w-36', img: 'h-16 w-16 sm:h-28 sm:w-28' },
  lg: { box: 'h-36 w-36 sm:h-52 sm:w-52', img: 'h-24 w-24 sm:h-40 sm:w-40' },
};

export function ReferenceFace({
  size = 'md',
  caption = 'Match this face',
  className,
}: ReferenceFaceProps) {
  const s = sizes[size];
  return (
    <figure className={cn('flex flex-col items-center gap-2', className)}>
      <div
        className={cn(
          'relative flex items-center justify-center border-2 border-ink bg-paper shadow-stamp',
          s.box,
        )}
      >
        <span className="absolute inset-1 halftone opacity-60" aria-hidden />
        <img
          src="/trollface.png"
          alt="Reference troll face"
          className={cn('relative object-contain', s.img)}
        />
      </div>
      {caption ? (
        <figcaption className="font-mono text-[10px] uppercase tracking-stamp text-muted-fg">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
