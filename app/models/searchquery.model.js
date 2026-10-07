const mongoose = require("mongoose");

const SearchQuerySchema = new mongoose.Schema(
  {
    term: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
  },
  { timestamps: true }
);

SearchQuerySchema.index({ createdAt: -1 });

module.exports =
  mongoose.models.SearchQuery ||
  mongoose.model("SearchQuery", SearchQuerySchema);
