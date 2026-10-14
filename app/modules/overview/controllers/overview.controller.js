const mongoose = require("mongoose");
const overviewModel = require("../models/overview.model");
let moment = require("moment-timezone");
const view = require('../../../core/view')('overview');

const TZ = 'Asia/Bangkok';

// The Overview dashboard monitors the connected MongoDB server. The page renders with a first
// sample and then polls /overview/live (mongostat, mongotop, operations, locks) and
// /overview/details (sizes, replica set, sharding, profiler, log).
exports.index = async function (req, res) {
  const [live, details] = await Promise.all([overviewModel.live(), overviewModel.details()]);
  return res.renderPage(view('overview'), {
    title: 'MongoDB Overview : ' + mongoose.connection.name,
    dbName: mongoose.connection.name,
    updatedAt: moment().tz(TZ).format('DD/MM/YYYY HH:mm:ss'),
    live,
    details
  });
};

exports.live = async function (req, res) {
  return res.json(await overviewModel.live());
};

exports.details = async function (req, res) {
  return res.json(await overviewModel.details());
};
