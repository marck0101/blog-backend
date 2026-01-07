const mongoose = require("mongoose");

const BlogPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    excerpt: String,
    content: { type: String, required: true },

    category: {
      type: String,
      enum: ["marketing", "trafego", "growth", "tecnologia"],
      required: true,
    },

    coverImage: String,

    gallery: [
      {
        url: String,
        alt: String,
      },
    ],

    published: { type: Boolean, default: false },
    publishedAt: Date,

    seo: {
      title: String,
      description: String,
    },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.BlogPost ||
  mongoose.model("BlogPost", BlogPostSchema);
