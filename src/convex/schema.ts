import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	shoots: defineTable({
		folderName: v.string(),
		name: v.string(),
		date: v.string(),
		createdAt: v.string(),
		algorithm: v.union(v.literal('DeepPRIME 3'), v.literal('DeepPRIME XD3'), v.null()),
		notes: v.string(),
		rawCount: v.union(v.number(), v.null())
	}).index('by_folder', ['folderName']),

	ratings: defineTable({
		shootId: v.id('shoots'),
		fileName: v.string(),
		rating: v.number()
	})
		.index('by_shoot', ['shootId'])
		.index('by_shoot_file', ['shootId', 'fileName'])
});
