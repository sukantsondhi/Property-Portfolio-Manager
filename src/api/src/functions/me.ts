import { app } from "@azure/functions";
import { authenticatePlatform } from "../services/auth";
import { json, problem } from "../services/responses";

app.http("me", {
  methods: ["GET"], authLevel: "anonymous", route: "me",
  handler: async (request) => {
    try { return json(200, await authenticatePlatform(request)); }
    catch (error) { return problem(error); }
  },
});
