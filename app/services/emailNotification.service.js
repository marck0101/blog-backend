const transporter = require("../config/mailer");
const Subscriber = require("../models/subscriber.model");
const newPostEmail = require("../templates/newPost.email");

const SITE_URL = "https://blog.marck0101.com.br";
const API_URL = "https://api.blog.marck0101.com.br";

async function notifySubscribers(post) {
  const subscribers = await Subscriber.find({
    status: "active",
    categories: post.category,
  });

  if (subscribers.length === 0) {
    console.log(`[EMAIL] Enviado para 0 assinantes da categoria ${post.category}`);
    return;
  }

  const postUrl = `${SITE_URL}/blog/${post.slug}`;

  const results = await Promise.allSettled(
    subscribers.map((subscriber) => {
      const unsubscribeUrl = `${API_URL}/api/subscribers/unsubscribe/${subscriber.token}`;

      return transporter.sendMail({
        from: `"marck0101" <${process.env.GMAIL_USER}>`,
        to: subscriber.email,
        subject: `Novo artigo: ${post.title} | marck0101`,
        html: newPostEmail({
          subscriberName: subscriber.name,
          postTitle: post.title,
          postSummary: post.excerpt,
          postUrl,
          unsubscribeUrl,
        }),
      });
    })
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  console.log(`[EMAIL] Enviado para ${sent} assinantes da categoria ${post.category}`);
}

module.exports = { notifySubscribers };
