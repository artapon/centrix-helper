const labmasterModel = require("../models/labmaster.model");
const view = require('../../../core/view')('tools');

exports.index = async function (req, res) {
  let labcode = req.query.labcode || '';
  let labmasters = await labmasterModel.getlabMasterData(labcode);

  return res.renderPage(view('labmaster'), {
    title:  'Lab Master Data',
    labmasters: labmasters
  });
};

exports.export = async function (req, res) {
  let labmasters = await labmasterModel.getlabMasterData();
  res.xls('labmaster.xlsx', labmasters);
}
