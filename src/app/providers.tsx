'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import type { InvalidationEvent } from '@/lib/types';

/**
 * Bridges the server's invalidation stream to the query cache. The stream
 * carries no data — it only says "this shoot changed", and React Query
 * refetches through the ordinary read paths.
 */
function InvalidationListener() {
	const queryClient = useQueryClient();

	useEffect(() => {
		const source = new EventSource('/api/events');

		source.onmessage = (message) => {
			try {
				const event: InvalidationEvent = JSON.parse(message.data);
				queryClient.invalidateQueries({ queryKey: ['shoots'] });
				if (event.folderName) {
					queryClient.invalidateQueries({ queryKey: ['shoot', event.folderName] });
				}
			} catch {
				// Ignore malformed frames.
			}
		};

		// On error EventSource reconnects on its own; refetch-on-focus and the
		// polling interval cover the gap in the meantime.
		return () => source.close();
	}, [queryClient]);

	return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 5_000,
						refetchOnWindowFocus: true,
						refetchInterval: 15_000
					}
				}
			})
	);

	return (
		<QueryClientProvider client={queryClient}>
			<InvalidationListener />
			{children}
		</QueryClientProvider>
	);
}
