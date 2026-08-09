// Loads this repo's own .env (not the parent hackathon-stack folder's — this
// product has to run standalone). Require this first, before any module that
// reads process.env (lgtm.js, draft.js, server.js).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
