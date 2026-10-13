const Season = require("../models/season.model");
const DEFAULT_SEASONS = require("../config/seasons");

// As seasons agora ficam no banco (gerenciadas no admin). Na primeira vez em
// cada banco, cadastra as que existiam em app/config/seasons.js.
let seeded = false;
async function ensureDefaultSeasons() {
  if (seeded) return;
  for (const [i, s] of DEFAULT_SEASONS.entries()) {
    await Season.updateOne(
      { slug: s.slug },
      { $setOnInsert: { slug: s.slug, title: s.label, description: s.description || "", order: i } },
      { upsert: true }
    );
  }
  seeded = true;
}

async function seasonExists(slug) {
  await ensureDefaultSeasons();
  return Boolean(await Season.exists({ slug }));
}

module.exports = { ensureDefaultSeasons, seasonExists };
