import { useTranslate } from '../i18n/locale';

export function ReviewTime({ due }: { readonly due: string }) {
  const t = useTranslate();
  const date = new Date(due);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const day =
    date.toDateString() === now.toDateString()
      ? t('time.today')
      : date.toDateString() === tomorrow.toDateString()
        ? t('time.tomorrow')
        : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const minutes = Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 60_000));
  return (
    <span className="inline-flex flex-col gap-4">
      <time dateTime={due}>
        {day},{' '}
        {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}
      </time>
      <span className="text-12 text-secondary">
        {t('time.relative', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })}
      </span>
    </span>
  );
}
