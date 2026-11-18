import type { TimeWindow } from '../cli.js';

const WEEK_HOURS = 24 * 7;
/** Tolerance for boards that post with a skewed clock or a future start date. */
const FUTURE_TOLERANCE_HOURS = 24;

/**
 * Whether a posting is recent enough to report.
 *
 * A job with no usable posting date is kept: ATS boards sometimes omit the
 * date, and dropping those would silently hide real postings. Dedupe is what
 * stops them being re-reported on later runs.
 */
export function withinWindow(
  postedAt: string | null,
  now: Date,
  maxAgeHours: number,
  window: TimeWindow = 'day',
): boolean {
  if (postedAt === null) return true;
  const posted = new Date(postedAt).getTime();
  if (Number.isNaN(posted)) return true;

  const limitHours = window === 'week' ? Math.max(maxAgeHours, WEEK_HOURS) : maxAgeHours;
  const ageHours = (now.getTime() - posted) / 3_600_000;
  return ageHours <= limitHours && ageHours >= -FUTURE_TOLERANCE_HOURS;
}
