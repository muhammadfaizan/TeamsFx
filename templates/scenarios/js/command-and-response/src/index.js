// Create HTTP server.
const restify = require("restify");
const { commandApp } = require("./internal/initialize");

// This template uses `restify` to serve HTTP responses.
// Create a restify server.
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, () => {
  console.log(`\nApp Started, ${server.name} listening to ${server.url}`);
});

// Register an API endpoint with `restify`. Teams sends messages to your application
// through this endpoint.
//
// The Teams Toolkit bot registration configures the bot with `/api/messages` as the
// Bot Framework endpoint. If you customize this route, update the Bot registration
// in `templates/azure/provision/botservice.bicep`.
server.post("/api/messages", async (req, res) => {
  await commandApp.requestHandler(req, res);
});
