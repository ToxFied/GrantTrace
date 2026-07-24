const SECRET_SHAPES = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu,
  /(?:^|[^A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/u,
  /(?:^|[^A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/u,
  /(?:^|[^A-Za-z0-9])npm_[A-Za-z0-9]{20,}/u,
  /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u,
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/iu,
];

export function isSafeReviewText(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length >= 1 &&
    normalized.length <= 240 &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(normalized) &&
    SECRET_SHAPES.every((pattern) => !pattern.test(normalized))
  );
}
