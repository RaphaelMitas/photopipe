/**
 * Format bytes into a human-readable string (e.g. "1.5 GB")
 */
export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / Math.pow(1024, i);
	return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Format seconds into a human-readable duration (e.g. "2 hrs 15 min")
 */
export function formatDuration(totalSeconds: number): string {
	if (totalSeconds < 60) return `${Math.round(totalSeconds)} sec`;
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.round((totalSeconds % 3600) / 60);
	if (hours === 0) return `${minutes} min`;
	if (minutes === 0) return `${hours} hr${hours > 1 ? 's' : ''}`;
	return `${hours} hr${hours > 1 ? 's' : ''} ${minutes} min`;
}

/**
 * Parse a shoot folder name into date and name parts.
 * Expected format: "YYYY-MM-DD_some-name"
 */
export function parseShootFolder(folderName: string): { date: string; name: string } | null {
	const match = folderName.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);
	if (!match) return null;
	// Convert hyphens back to spaces for display
	const displayName = match[2].replace(/-/g, ' ');
	return { date: match[1], name: displayName };
}

/**
 * Convert a human-readable shoot name into the folder-safe slug.
 * "Spring Concert" → "spring-concert"
 */
export function slugifyName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9\-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

/**
 * Build the full folder name from date + name.
 * "Spring Concert" + "2026-04-10" → "2026-04-10_spring-concert"
 */
export function buildFolderName(name: string, date: string): string {
	return `${date}_${slugifyName(name)}`;
}

/**
 * Format a date string for display
 */
export function formatDate(dateStr: string): string {
	try {
		return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
			weekday: 'short',
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	} catch {
		return dateStr;
	}
}
