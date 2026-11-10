// Fonte única das categorias (R-POST-02): model, validações e /api/categories
// leem daqui. Categoria nova = só uma linha nesta lista.
const CATEGORIES = [
  { slug: "tecnologia", label: "Tecnologia" },
  { slug: "design", label: "Design" },
  { slug: "carreira", label: "Carreira" },
  { slug: "negocios", label: "Negócios" },
  { slug: "marketing", label: "Marketing" },
  { slug: "trafego", label: "Tráfego" },
  { slug: "growth", label: "Growth" },
];

module.exports = CATEGORIES;
// Só os slugs (fora do JSON de /api/categories: res.json de array ignora esta propriedade)
module.exports.SLUGS = CATEGORIES.map((c) => c.slug);
