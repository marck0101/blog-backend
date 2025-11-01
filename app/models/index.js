const dbConfig = require("../config/db.config.js");
const mongoose = require("mongoose");
mongoose.Promise = global.Promise;

const db = {};
db.mongoose = mongoose;
db.url = dbConfig.url;

// carrega models corretamente
db.blogposts = require("./blogpost.model.js")(mongoose);
db.deletedBlogposts = require("./deletedBlogposts.model.js")(mongoose);

module.exports = db;
