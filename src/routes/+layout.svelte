<script lang="ts">
	import '../app.css';
	import { setupConvex } from 'convex-svelte';
	import { env } from '$env/dynamic/public';

	let { children } = $props();
	setupConvex(env.PUBLIC_CONVEX_URL!);
</script>

<div class="app">
	<header>
		<nav>
			<a href="/" class="logo">
				<svg
					class="logo-icon"
					width="22"
					height="22"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="10" />
					<circle cx="12" cy="12" r="4" />
					<line x1="12" y1="2" x2="12" y2="6" />
					<line x1="12" y1="18" x2="12" y2="22" />
					<line x1="2" y1="12" x2="6" y2="12" />
					<line x1="18" y1="12" x2="22" y2="12" />
				</svg>
				<span>Photopipe</span>
			</a>
			<div class="nav-right">
				<a href="/" class="nav-link">Shoots</a>
				<a href="/new" class="btn-primary btn-nav">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg
					>
					New Shoot
				</a>
			</div>
		</nav>
	</header>

	<main>
		{@render children()}
	</main>
</div>

<style>
	.app {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	header {
		position: sticky;
		top: 0;
		z-index: 100;
		background: rgba(9, 9, 11, 0.7);
		backdrop-filter: blur(16px) saturate(180%);
		-webkit-backdrop-filter: blur(16px) saturate(180%);
		border-bottom: 1px solid var(--border);
	}

	nav {
		max-width: 1120px;
		margin: 0 auto;
		padding: 0.75rem 1.5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text);
		font-weight: 600;
		font-size: 0.9333rem;
		letter-spacing: -0.01em;
	}

	.logo:hover {
		color: var(--accent-light);
	}

	.logo-icon {
		color: var(--accent-light);
	}

	.nav-right {
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}

	.nav-link {
		font-size: 0.8667rem;
		color: var(--text-secondary);
		font-weight: 450;
	}

	.nav-link:hover {
		color: var(--text);
	}

	.btn-nav {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8rem;
		padding: 0.35rem 0.65rem;
		border-radius: var(--radius-sm);
	}

	.btn-nav svg {
		flex-shrink: 0;
	}

	main {
		flex: 1;
		max-width: 1120px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
		width: 100%;
		animation: slide-up 0.35s ease;
	}
</style>
