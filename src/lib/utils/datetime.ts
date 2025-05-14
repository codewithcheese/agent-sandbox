export function humanTime(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // If less than 1 hour ago
  if (diffMins < 60) {
    return diffMins === 0 ? "just now" : `${diffMins}m`;
  }

  // If less than 24 hours ago
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  // If less than 7 days ago
  if (diffDays < 7) {
    return `${diffDays}d`;
  }

  // If this year, show month and day
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  // Otherwise show date with year
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
