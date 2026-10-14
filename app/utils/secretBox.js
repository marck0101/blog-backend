const crypto = require("crypto");

// Criptografa segredos guardados no banco (segredo do app autenticador):
// se o banco vazar, o segredo sozinho não serve para gerar códigos.
// AES-256-GCM com a chave MFA_SECRET_KEY.
//
// Sem MFA_SECRET_KEY, usa uma chave derivada do JWT_SECRET ("legada"). Quem
// cadastrou o app antes de definir MFA_SECRET_KEY continua funcionando: o
// segredo abre com a chave legada e é regravado com a nova (ver openSecret).
const deriveKey = (source) => crypto.createHash("sha256").update(source).digest();

const legacyKey = () => deriveKey(`${process.env.JWT_SECRET}:mfa-secret-box`);

function primaryKey() {
  if (process.env.MFA_SECRET_KEY) return deriveKey(process.env.MFA_SECRET_KEY);
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET não configurado");
  return legacyKey();
}

function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", primaryKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

function openWith(key, sealed) {
  const [version, iv, tag, data] = String(sealed || "").split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Segredo em formato inválido");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/**
 * Abre o segredo. Devolve { plain, resealed }: resealed vem preenchido quando
 * o segredo estava na chave legada — quem chamou deve gravá-lo no lugar do antigo.
 */
function openSecret(sealed) {
  try {
    return { plain: openWith(primaryKey(), sealed), resealed: null };
  } catch (err) {
    if (!process.env.MFA_SECRET_KEY) throw err;
    const plain = openWith(legacyKey(), sealed); // falhando aqui, o erro sobe
    return { plain, resealed: seal(plain) };
  }
}

const open = (sealed) => openSecret(sealed).plain;

module.exports = { seal, open, openSecret };
