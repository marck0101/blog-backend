import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const mongoose = require("mongoose");
const { isEmail, categoriesError, isId, isIdList } = require("../../app/utils/validators");

// DUP-03: validações compartilhadas entre assinantes, envios e públicos
describe("isEmail", () => {
  it.each(["a@b.co", "nome.sobrenome+tag@empresa.com.br"])("%s é válido", (v) => expect(isEmail(v)).toBe(true));
  it.each(["", "sem-arroba", "a@b", "a b@c.com", `${"a".repeat(250)}@b.com`, { $ne: null }, null])(
    "%j é inválido",
    (v) => expect(isEmail(v)).toBe(false)
  );
});

describe("categoriesError", () => {
  it("lista vazia ou só de categorias existentes: sem erro", () => {
    expect(categoriesError([])).toBeNull();
    expect(categoriesError(["tecnologia", "growth"])).toBeNull();
  });
  it("aponta as inválidas pelo nome", () => {
    expect(categoriesError(["tecnologia", "x", "y"])).toBe("Categorias inválidas: x, y");
  });
  it.each(["tecnologia", { $in: [] }, [{}], null])("%j não é lista de texto", (v) => {
    expect(categoriesError(v)).toBe("Categorias inválidas");
  });
});

describe("isId / isIdList", () => {
  const hex = "64b000000000000000000000";
  it("aceita id em texto (painel) e ObjectId (banco)", () => {
    expect(isId(hex)).toBe(true);
    expect(isId(new mongoose.Types.ObjectId(hex))).toBe(true);
  });
  it.each([{ $ne: null }, "abc", "123456789012", 123, null])("%j não é id", (v) => expect(isId(v)).toBe(false));
  it("lista", () => {
    expect(isIdList([hex, new mongoose.Types.ObjectId()])).toBe(true);
    expect(isIdList([])).toBe(true);
    expect(isIdList(hex)).toBe(false);
    expect(isIdList([hex, { $gt: "" }])).toBe(false);
  });
});
