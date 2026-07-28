/**
 * Define your collections here.
 * Each collection becomes a SQLite table + REST CRUD endpoints.
 *
 * API: /api/collections/<name>
 *   GET    /           → list (paginated, filtered)
 *   GET    /:id        → get by ID
 *   POST   /           → create
 *   PATCH  /:id        → update
 *   DELETE /:id        → delete (soft by default, ?hard=true for hard)
 */

import { defineCollection, f } from './src/schema/define.js'

// Example: posts collection
export const posts = defineCollection('posts', {
  fields: {
    title: f.string().required().max(200),
    content: f.text().optional(),
    slug: f.string().unique(),
    published: f.boolean().default(false),
    viewCount: f.integer().default(0),
    // Better Auth table is "user" (singular)
    authorId: f.reference('user').required(),
  },
  indexes: [
    { fields: ['authorId', 'createdAt'], name: 'idx_posts_author' },
    { fields: ['slug'], unique: true },
  ],
  access: {
    create: 'owner',
    read: 'owner',
    update: 'owner',
    delete: 'owner',
    ownerField: 'authorId',
  },
})
