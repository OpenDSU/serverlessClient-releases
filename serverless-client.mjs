const s = require("./ServerlessClient"), l = require("./utils/PendingCallMixin"), c = require("./utils/getBaseURL");
async function o(e, n, r, t, a, i) {
  return await new s(e, n, r, t, i).init();
}
module.exports = {
  createServerlessAPIClient: o,
  PendingCallMixin: l,
  getBaseURL: c
};
