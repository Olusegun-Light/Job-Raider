export type SourceName = 'serper' | 'greenhouse' | 'lever' | 'ashby';

export type SponsorshipVerdict = 'yes' | 'no' | 'unknown';

/** Which location bucket a job landed in. Drives the digest sections. */
export type LocationBucket = 'uk' | 'remote' | 'lagos' | 'other';

/** The normalized job every source must produce (JOB_RADAR_PLAN.md §4). */
export type Job = {
  /** Stable hash of the normalized URL. */
  id: string;
  title: string;
  company: string;
  /** Normalized: tracking params stripped, no trailing slash. */
  url: string;
  /** Raw location text as the source gave it. */
  location: string | null;
  remote: boolean | null;
  /** ISO 8601, or null when the source does not say. */
  postedAt: string | null;
  source: SourceName;
  /** Plain text, HTML stripped. Null for Serper (see `snippet`). */
  description: string | null;
  snippet: string | null;
  sponsorship: SponsorshipVerdict;
  ukSponsorLicensed: boolean | null;
  score: number;
  matchedKeywords: string[];
};

/** A job that has been through filter + score and knows where it belongs. */
export type ScoredJob = Job & {
  bucket: LocationBucket;
  /** Ids of other records of this same posting, collapsed during dedupe. */
  duplicateIds?: string[];
};

export type SourceStats = {
  source: SourceName;
  fetched: number;
  passedFilter: number;
  new: number;
  errors: string[];
};

export type RunStats = {
  startedAt: string;
  durationMs: number;
  scanned: number;
  delivered: number;
  perSource: SourceStats[];
  /** Serper credits consumed this run, when the source ran. */
  serperCredits: number | null;
};

export type Deliverer = {
  name: string;
  deliver(jobs: ScoredJob[], stats: RunStats): Promise<void>;
  /** Sent when the run itself blows up. */
  deliverError(error: Error, context: string): Promise<void>;
};
