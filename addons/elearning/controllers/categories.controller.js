// E-Learning > Categories: the categories courses are filed under (its own menu item, /e-learning/categories).
const view = require('../../../app/core/view').addon('elearning');
const categories = require('../models/categories.model');

const id = (v) => parseInt(v, 10);
const username = (req) => (req.user && req.user.username) || '';

function fail(res, err, what) {
  if (err && err.expose) return res.status(err.status || 400).json({ error: err.message });
  console.error(`E-Learning categories: ${what}:`, err);
  return res.status(500).json({ error: `The ${what} failed. The details are in the server log.` });
}

exports.index = async function (req, res) {
  return res.renderPage(view('categories'), { title: 'Course Categories', list: await categories.list() });
};

exports.create = async function (req, res) {
  try {
    res.json({ category: await categories.create(req.body, username(req)) });
  } catch (err) { fail(res, err, 'saving of the category'); }
};

exports.update = async function (req, res) {
  try {
    const c = await categories.update(id(req.params.id), req.body, username(req));
    if (!c) return res.status(404).json({ error: 'Category not found.' });
    res.json({ category: c });
  } catch (err) { fail(res, err, 'saving of the category'); }
};

exports.remove = async function (req, res) {
  try {
    if (!(await categories.remove(id(req.params.id)))) return res.status(404).json({ error: 'Category not found.' });
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'deletion of the category'); }
};

exports.reorder = async function (req, res) {
  try {
    res.json({ list: await categories.reorder(req.body && req.body.ids) });
  } catch (err) { fail(res, err, 'saving of the order'); }
};
