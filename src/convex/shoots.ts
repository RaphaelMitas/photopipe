import { query, mutation } from './_generated/server';
import { v } from 'convex/values';

export const getByFolder = query({
	args: { folderName: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('shoots')
			.withIndex('by_folder', (q) => q.eq('folderName', args.folderName))
			.unique();
	}
});

export const list = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('shoots').collect();
	}
});

export const upsert = mutation({
	args: {
		folderName: v.string(),
		name: v.string(),
		date: v.string(),
		createdAt: v.string(),
		algorithm: v.union(v.literal('DeepPRIME 3'), v.literal('DeepPRIME XD3'), v.null()),
		notes: v.string(),
		rawCount: v.union(v.number(), v.null())
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('shoots')
			.withIndex('by_folder', (q) => q.eq('folderName', args.folderName))
			.unique();

		if (existing) {
			await ctx.db.patch(existing._id, {
				name: args.name,
				date: args.date,
				createdAt: args.createdAt,
				algorithm: args.algorithm,
				notes: args.notes,
				rawCount: args.rawCount
			});
			return existing._id;
		}

		return await ctx.db.insert('shoots', args);
	}
});

export const updateFields = mutation({
	args: {
		folderName: v.string(),
		algorithm: v.optional(v.union(v.literal('DeepPRIME 3'), v.literal('DeepPRIME XD3'), v.null())),
		notes: v.optional(v.string()),
		rawCount: v.optional(v.union(v.number(), v.null()))
	},
	handler: async (ctx, args) => {
		const shoot = await ctx.db
			.query('shoots')
			.withIndex('by_folder', (q) => q.eq('folderName', args.folderName))
			.unique();

		if (!shoot) return null;

		const updates: Record<string, unknown> = {};
		if (args.algorithm !== undefined) updates.algorithm = args.algorithm;
		if (args.notes !== undefined) updates.notes = args.notes;
		if (args.rawCount !== undefined) updates.rawCount = args.rawCount;

		await ctx.db.patch(shoot._id, updates);

		return await ctx.db.get(shoot._id);
	}
});

export const remove = mutation({
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

		await ctx.db.delete(shoot._id);
	}
});
