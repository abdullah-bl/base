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
import { register } from './src/schema/index-registry.js'

// Example: posts collection
const posts = defineCollection('posts', {
  fields: {
    title: f.string().required().max(200),
    content: f.text().optional(),
    slug: f.string().unique(),
    published: f.boolean().default(false),
    viewCount: f.integer().default(0),
    authorId: f.reference('user').required(),
  },
  indexes: [
    { fields: ['authorId', 'createdAt'], name: 'idx_posts_author' },
    { fields: ['slug'], unique: true },
  ],
})

// Register collections so the server can mount their CRUD routes
register(posts)
