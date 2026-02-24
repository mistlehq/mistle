import { startServer } from "./server.js";

const port = Number(process.env.PORT ?? "3000");

startServer(port);

console.log("@mistle/tokenizer-proxy listening on port " + port);
