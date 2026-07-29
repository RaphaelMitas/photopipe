import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
	title: 'Photopipe',
	description: 'Self-hosted photo pipeline for camera shoots'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body className="min-h-screen">
				<Providers>
					<header className="border-line border-b">
						<div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
							<Link href="/" className="text-sm font-semibold tracking-tight">
								photopipe
							</Link>
							<Link href="/new" className="btn-primary btn-sm">
								New shoot
							</Link>
						</div>
					</header>
					<main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
				</Providers>
			</body>
		</html>
	);
}
