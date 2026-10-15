// POST <audit detail page>/lookup: { collection, refs: [{ path, id }] } -> the referenced
// records (code, name, description, statusflag), using the Query Data lookup rules.
exports.lookupHandler = async function (req, res) {
  try {
    const lookup = require("../models/lookup.model");
    res.json(await lookup.lookup(req.body || {}));
  } catch (err) {
    console.error("Audit lookup failed:", err.message);
    res.status(500).json({ error: err.message || "Lookup failed" });
  }
};
