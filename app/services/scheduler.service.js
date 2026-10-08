const BlogPost = require("../models/blogpost.model");
const Campaign = require("../models/campaign.model");
const { notifyNewPost, processCampaign, isMailerConfigured } = require("./campaign.service");

/**
 * Rotina diária (cron da Vercel):
 * 1. publica os posts agendados cuja data já chegou, disparando o email do post
 * 2. continua envios que ficaram "enviando" (lote não coube no tempo)
 */
async function runDailyJobs(now = new Date()) {
  const summary = { published: [], resumed: [], errors: [] };

  const due = await BlogPost.find({
    status: "planned",
    deletedAt: null,
    plannedAt: { $lte: now },
  }).sort({ plannedAt: 1 });

  for (const post of due) {
    try {
      post.status = "published";
      post.published = true;
      post.publishedAt = now;
      await post.save();
      summary.published.push(post.title);
    } catch (err) {
      summary.errors.push(`publicar "${post.title}": ${err.message}`);
      continue;
    }

    // Falha no email não desfaz a publicação; o aviso fica em Envios
    try {
      await notifyNewPost(post);
    } catch (err) {
      summary.errors.push(`email de "${post.title}": ${err.message}`);
    }
  }

  if (isMailerConfigured()) {
    const stuck = await Campaign.find({ status: "sending" });
    for (const campaign of stuck) {
      try {
        await processCampaign(campaign);
        summary.resumed.push(campaign.subject);
      } catch (err) {
        summary.errors.push(`envio "${campaign.subject}": ${err.message}`);
      }
    }
  }

  console.log("[CRON]", JSON.stringify(summary));
  return summary;
}

module.exports = { runDailyJobs };
