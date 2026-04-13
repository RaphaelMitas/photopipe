import { query, mutation } from './_generated/server';
import { v } from 'convex/values';

export const getForShoot = query({
	args: { folderName: v.string() },
	handler: async (ctx, args) => {
		const shoot = await ctx.db
			.query('shoots')
			.withIndex('by_folder', (q) => q.eq('folderName', args.folderName))
			.unique();

		if (!shoot) return {};

		const ratings = await ctx.db
			.query('ratings')
			.withIndex('by_shoot', (q) => q.eq('shootId', shoot._id))
			.collect();

		const result: Record<string, number> = {};
		for (const r of ratings) {
			result[r.fileName] = r.rating;
		}
		return result;
	}
});

export const upsertMany = mutation({
	args: {
		folderName: v.string(),
		ratings: v.array(v.object({ fileName: v.string(), rating: v.number() }))
	},
	handler: async (ctx, args) => {
		const shoot = await ctx.db
			.query('shoots')
			.withIndex('by_folder', (q) => q.eq('folderName', args.folderName))
			.unique();

		if (!shoot) return;

		for (const { fileName, rating } of args.ratings) {
			const existing = await ctx.db
				.query('ratings')
				.withIndex('by_shoot_file', (q) => q.eq('shootId', shoot._id).eq('fileName', fileName))
				.unique();

			if (existing) {
				await ctx.db.patch(existing._id, { rating });
			} else {
				await ctx.db.insert('ratings', {
					shootId: shoot._id,
					fileName,
					rating
				});
			}
		}
	}
});

export const deleteMany = mutation({
	args: {
		folderName: v.string(),
		fileNames: v.array(v.string())
	},
	handler: async (ctx, args) => {
		const shoot = await ctx.db
			.query('shoots')
			.withIndex('by_folder', (q) => q.eq('folderName', args.folderName))
			.unique();

		if (!shoot) return;

		for (const fileName of args.fileNames) {
			const existing = await ctx.db
				.query('ratings')
				.withIndex('by_shoot_file', (q) => q.eq('shootId', shoot._id).eq('fileName', fileName))
				.unique();

			if (existing) {
				await ctx.db.delete(existing._id);
			}
		}
	}
});

export const deleteAllForShoot = mutation({
	args: { folderName: v.string() },
	handler: async (ctx, args) => {
		const shoot = await ctx.db
			.query('shoots')
			.withIndex('by_folder', (q) => q.eq('folderName', args.folderName))
			.unique();

		if (!shoot) return;

		const ratings = await ctx.db
			.query('ratings')
			.withIndex('by_shoot', (q) => q.eq('shootId', shoot._id))
			.collect();

		for (const rating of ratings) {
			await ctx.db.delete(rating._id);
		}
	}
});
