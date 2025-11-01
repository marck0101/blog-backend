module.exports = (mongoose) => {
  const schema = mongoose.Schema(
    {
      title: String,
      description: String,
      published: Boolean,
      imageUrl: String,
      imageUrls: [String],
      deletedAt: Date,
    },
    { timestamps: true }
  );

  const DeletedBlogpost = mongoose.model("deletedBlogpost", schema);
  return DeletedBlogpost;
};
