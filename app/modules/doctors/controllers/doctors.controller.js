
const organisationsModel = require("../../../core/models/organisations.model");
const patientvisitModel = require("../../patients/models/patientvisits.model");
let moment = require("moment-timezone");
const view = require('../../../core/view')('doctors');
exports.monitor = async function (req, res) {

  let currentdate = req.query.date;
  let limit = req.query.limit || 5;
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let visits = [];
  if(!currentdate)
    currentdate =  moment().tz("Asia/Bangkok").format("YYYY-MM-DD");

  visits = await patientvisitModel.getTodayVisitByCareprovider(currentdate, org[0]._id);
  res.renderPage(view('doctors'), {
    title:  'Careprovider Visits Monitors : ' + org[0].name + " : " + currentdate + " : แถบแดงหมายถึง Active Visit มากกว่าเท่ากับ " + limit + " visits",
    visits: visits,
    limit : limit
  });
}

exports.visits = async function (req, res) {
  let currentdate = req.query.date;
  if(!currentdate)
    currentdate =  moment().tz("Asia/Bangkok").format("YYYY-MM-DD");
  
  let careprovideruid = req.params.careprovideruid;
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  visits = await patientvisitModel.getVisitByCareproviderUID(currentdate, careprovideruid, org[0]._id);
  return res.renderPage(view('visits'), {
    title:  visits[0].careprovider + ' Visits',
    visits: visits
  });
}