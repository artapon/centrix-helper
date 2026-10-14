
const organisationsModel = require("../../../core/models/organisations.model");
const careprovidersModel = require("../models/careproviderschedules.model");
let moment = require("moment-timezone");
let _ = require('lodash');
const view = require('../../../core/view')('doctors');
exports.careproviderSchedule = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);

  schedules = await careprovidersModel.getCareProvidersSchedule(org[0]._id);
  return res.renderPage(view('careprovider'), {
    title:  'Careprovider Schedules : ' + org[0].name,
    schedules: schedules
  });
}