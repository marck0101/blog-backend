const mongoose = require("mongoose");
const crypto = require("crypto");

const SubscriberSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      trim: true,
    },
    categories: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ["active", "unsubscribed"],
      default: "active",
    },
    token: {
      type: String,
    },
    confirmedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

SubscriberSchema.index({ email: 1 });
SubscriberSchema.index({ token: 1 });

SubscriberSchema.pre("save", function (next) {
  if (!this.token) {
    this.token = crypto.randomBytes(32).toString("hex");
  }
  next();
});

module.exports = mongoose.model("Subscriber", SubscriberSchema);
