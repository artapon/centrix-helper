
const organisationsModel = require("../../../core/models/organisations.model");
const patientpackagesModel = require("../models/patientpackages.model");
const view = require('../../../core/view')('patients');
exports.patientPackageItems = async function (req, res) {
  let ordersetuid = req.params.ordersetuid || "";
  let totalprices = 0;
  let totaldfshare = 0;
  let orgcode = req.session.sitecode;
  let org = await organisationsModel.getOrgData(orgcode);
  let orderset = await patientpackagesModel.getOrderSetData(org[0]._id, ordersetuid);
  let packageitems = await patientpackagesModel.getPatientPackagesItems(org[0]._id, orderset[0]._id);
  packageitems.forEach(function(item){
    totalprices += parseFloat(item.packageitemprice);
  })
  packageitems.forEach(function(item){
    totaldfshare += parseFloat(item.doctoritemshare);
  })
  return res.renderPage(view('packageitems'), {
    title:  orderset[0].code + ' ' + orderset[0].name + ' Package items : ' + org[0].name,
    packageitems : packageitems,
    totalprices : totalprices,
    totaldfshare : totaldfshare
  });
}