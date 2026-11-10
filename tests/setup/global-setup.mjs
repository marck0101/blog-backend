import { MongoMemoryServer } from "mongodb-memory-server";

// Um MongoDB em memória para a execução inteira. Os arquivos de teste recebem
// o endereço por inject("mongoUri") (ver env.mjs).
let server;

export async function setup({ provide }) {
  server = await MongoMemoryServer.create();
  provide("mongoUri", server.getUri("blog_test"));
}

export async function teardown() {
  await server?.stop();
}
