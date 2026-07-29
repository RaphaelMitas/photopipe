export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / Math.pow(1024, i);
	return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(totalSeconds: number): string {
	if (totalSeconds < 60) return `${Math.round(totalSeconds)} sec`;
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.round((totalSeconds % 3600) / 60);
	if (hours === 0) return `${minutes} min`;
	if (minutes === 0) return `${hours} hr${hours > 1 ? 's' : ''}`;
	return `${hours} hr${hours > 1 ? 's' : ''} ${minutes} min`;
}

/** "2026-04-10_spring-concert" → { date, name: "spring concert" } */
export function parseShootFolder(folderName: string): { date: string; name: string } | null {
	const match = folderName.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);
	if (!match?.[1] || !match[2]) return null;
	return { date: match[1], name: match[2].replace(/-/g, ' ') };
}

/** "Spring Concert" → "spring-concert" */
export function slugifyName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

export function buildFolderName(name: string, date: string): string {
	return `${date}_${slugifyName(name)}`;
}

export function formatDate(dateStr: string): string {
	try {
		return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
			weekday: 'short',
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	} catch {
		return dateStr;
	}
}

export function fileExtension(fileName: string): string {
	const dot = fileName.lastIndexOf('.');
	return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

export function stripExtension(fileName: string): string {
	const dot = fileName.lastIndexOf('.');
	return dot === -1 ? fileName : fileName.slice(0, dot);
}
