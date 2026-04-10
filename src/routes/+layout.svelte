<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<div class="app">
	<header>
		<nav>
			<a href="/" class="logo">Photopipe</a>
			<div class="nav-links">
				<a href="/">Dashboard</a>
				<a href="/new" class="btn-primary btn-new">New Shoot</a>
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
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border);
		position: sticky;
		top: 0;
		z-index: 100;
	}

	nav {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0.75rem 1.5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.logo {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: -0.02em;
	}

	.logo:hover {
		text-decoration: none;
		color: var(--accent);
	}

	.nav-links {
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}

	.nav-links a:not(.btn-primary) {
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	.nav-links a:not(.btn-primary):hover {
		color: var(--text-primary);
		text-decoration: none;
	}

	.btn-new {
		font-size: 0.875rem;
		padding: 0.4rem 0.875rem;
	}

	main {
		flex: 1;
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
		width: 100%;
	}
</style>
