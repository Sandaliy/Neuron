import { useEffect, useRef, useState } from 'react';

import type { ReactNode } from 'react';

/** Unmount server controls while retaining their occupied space for the current visit. */
export function ReadOnlySlot({
  readOnly,
  children,
  fallback,
  inline = false,
  className,
}: {
  readonly readOnly: boolean;
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
  readonly inline?: boolean;
  readonly className?: string;
}) {
  const region = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (readOnly || !region.current) return;
    const element = region.current;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [readOnly]);
  return (
    <div
      ref={region}
      className={className}
      style={
        readOnly
          ? {
              minHeight: size.height,
              ...(inline ? { width: size.width } : {}),
            }
          : undefined
      }
    >
      {readOnly ? fallback : children}
    </div>
  );
}
