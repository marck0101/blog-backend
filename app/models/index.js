const dbConfig = require("../config/db.config.js");
const mongoose = require("mongoose");

mongoose.Promise = global.Promise;

const db = {};

db.mongoose = mongoose;
db.url = dbConfig.url;

// IMPORTANTE: não chamar como função
db.blogposts = require("./blogpost.model.js");

module.exports = db;
