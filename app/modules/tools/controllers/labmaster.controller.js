const labmasterModel = require("../models/labmaster.model");
const view = require('../../../core/view')('tools');

// 50 rows a page (?page=0, 1, …); one more is read to know whether there is a next page.
const PER_PAGE = 50;
exports.index = async function (req, res) {
  let labcode = String(req.query.labcode || '').trim();
  let page = Math.max(0, parseInt(req.query.page, 10) || 0);
  let rows = await labmasterModel.getlabMasterData(labcode, { skip: page * PER_PAGE, limit: PER_PAGE + 1 }) || [];

  return res.renderPage(view('labmaster'), {
    title:  'Lab Master Data',
    labmasters: rows.slice(0, PER_PAGE),
    labcode: labcode,
    page: page, perPage: PER_PAGE, hasMore: rows.length > PER_PAGE,
    nextpage: page + 1, lastpage: page > 0 ? page - 1 : 0
  });
};

exports.export = async function (req, res) {
  let labmasters = await labmasterModel.getlabMasterData();
  res.xls('labmaster.xlsx', labmasters);
}
