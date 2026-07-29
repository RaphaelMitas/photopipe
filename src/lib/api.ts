'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PhysicalStage, ShootDetail, StarRating } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, {
		...init,
		headers: init?.body ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers
	});
	if (!response.ok) {
		const body = await response.json().catch(() => null);
		throw new Error(body?.error ?? `Request failed (${response.status})`);
	}
	return response.json() as Promise<T>;
}

export function shootKey(folderName: string) {
	return ['shoot', folderName] as const;
}

export function useShoot(folderName: string, initialData?: ShootDetail) {
	return useQuery({
		queryKey: shootKey(folderName),
		queryFn: () => request<ShootDetail>(`/api/shoots/${encodeURIComponent(folderName)}`),
		initialData
	});
}

export function thumbUrl(
	folderName: string,
	stage: PhysicalStage,
	fileName: string,
	size: 'thumb' | 'preview' = 'thumb'
): string {
	return `/api/thumbs/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}?stage=${stage}&size=${size}`;
}

export function useRateMutation(folderName: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (ratings: Array<{ file: string; rating: StarRating | null }>) =>
			request<{ applied: number }>(`/api/shoots/${encodeURIComponent(folderName)}/rate`, {
				method: 'POST',
				body: JSON.stringify({ ratings })
			}),
		// Stars must land instantly while culling; the invalidation stream
		// reconciles whatever the server actually wrote.
		onMutate: async (ratings) => {
			await queryClient.cancelQueries({ queryKey: shootKey(folderName) });
			const previous = queryClient.getQueryData<ShootDetail>(shootKey(folderName));
			if (previous) {
				const byName = new Map(ratings.map((r) => [r.file, r.rating]));
				queryClient.setQueryData<ShootDetail>(shootKey(folderName), {
					...previous,
					files: previous.files.map((f) =>
						byName.has(f.name) ? { ...f, rating: byName.get(f.name) ?? null } : f
					)
				});
			}
			return { previous };
		},
		onError: (_err, _vars, context) => {
			if (context?.previous) queryClient.setQueryData(shootKey(folderName), context.previous);
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: shootKey(folderName) })
	});
}

export function useSelectMutation(folderName: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: { files?: string[]; isSelect?: boolean; minRating?: number }) =>
			request<{ applied: number }>(`/api/shoots/${encodeURIComponent(folderName)}/selects`, {
				method: 'POST',
				body: JSON.stringify(input)
			}),
		onMutate: async (input) => {
			if (!input.files) return {};
			await queryClient.cancelQueries({ queryKey: shootKey(folderName) });
			const previous = queryClient.getQueryData<ShootDetail>(shootKey(folderName));
			if (previous) {
				const targets = new Set(input.files);
				const next = input.isSelect ?? true;
				queryClient.setQueryData<ShootDetail>(shootKey(folderName), {
					...previous,
					files: previous.files.map((f) => (targets.has(f.name) ? { ...f, isSelect: next } : f))
				});
			}
			return { previous };
		},
		onError: (_err, _vars, context) => {
			if (context?.previous) queryClient.setQueryData(shootKey(folderName), context.previous);
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: shootKey(folderName) })
	});
}

export function useDeleteFilesMutation(folderName: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: { stage: PhysicalStage; files?: string[] }) =>
			request<{ deletedCount: number; freedBytes: number }>(
				`/api/shoots/${encodeURIComponent(folderName)}/files`,
				{ method: 'DELETE', body: JSON.stringify(input) }
			),
		onSettled: () => queryClient.invalidateQueries({ queryKey: shootKey(folderName) })
	});
}

/**
 * Uploads the file as a raw body rather than multipart so it streams to disk
 * on the server instead of being buffered whole.
 */
export async function uploadFile(
	folderName: string,
	stage: PhysicalStage,
	file: File
): Promise<void> {
	const url = `/api/upload/${encodeURIComponent(folderName)}?stage=${stage}&file=${encodeURIComponent(file.name)}`;
	const response = await fetch(url, { method: 'POST', body: file });
	if (!response.ok) {
		const body = await response.json().catch(() => null);
		throw new Error(body?.error ?? `Upload failed for ${file.name}`);
	}
}

export function finalizeUpload(folderName: string): Promise<{ rawCount: number }> {
	return request(`/api/upload/${encodeURIComponent(folderName)}`, { method: 'PATCH' });
}

export function createShoot(name: string, date: string): Promise<{ folderName: string }> {
	return request('/api/shoots', { method: 'POST', body: JSON.stringify({ name, date }) });
}

export function deleteShoot(folderName: string): Promise<{ ok: true }> {
	return request(`/api/shoots/${encodeURIComponent(folderName)}`, { method: 'DELETE' });
}
