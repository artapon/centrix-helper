const axios = require('axios');
const https = require('https');
const organisationsModel = require("../../../core/models/organisations.model");
const reportTemplateModel = require("../models/reporttemplate.model");
const view = require('../../../core/view')('reports');

// Create an HTTPS agent that ignores unauthorized SSL certificates, since HIS servers often use self-signed certs
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

/**
 * Render the Jasper Viewer page
 */
exports.index = async function (req, res) {
  let orgcode = req.session.sitecode;
  let org = null;
  if (orgcode) {
    try {
      const orgData = await organisationsModel.getOrgData(orgcode);
      if (orgData && orgData.length > 0) {
        org = orgData[0];
      }
    } catch (err) {
      console.error("Error fetching org data:", err.message);
    }

    if (org && org._id) {
      try {
        let reporttemplates = await reportTemplateModel.getAllReportTemplate(org._id);
        if (reporttemplates && reporttemplates.length > 0) {
          org.reporttemplates = reporttemplates;
        }
      } catch (err) {
        console.error("Error fetching report templates:", err.message);
      }
    }
  }

  return res.renderPage(view('jasperviewer'), {
    title: 'Jasper Report Viewer',
    org: org,
    centrixURL: req.session.centrixURL || ''
  });
};

/**
 * Proxy request to Jasper Server to bypass CORS and SSL certificate restrictions
 */
exports.proxy = async function (req, res) {
  const targetUrl = req.query.url;
  const username = req.query.username;
  const password = req.query.password;

  if (!targetUrl) {
    return res.status(400).send("Parameter 'url' is required.");
  }

  try {
    const config = {
      method: 'get',
      url: targetUrl,
      responseType: 'stream',
      httpsAgent: httpsAgent,
      timeout: 30000 // 30 seconds timeout
    };

    // Attach basic authentication if credentials are provided
    if (username && password) {
      config.auth = {
        username: username,
        password: password
      };
    }

    const response = await axios(config);

    // Forward relevant headers from the target response
    const contentType = response.headers['content-type'];
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    const contentDisposition = response.headers['content-disposition'];
    if (contentDisposition) {
      res.setHeader('Content-Disposition', contentDisposition);
    }

    // Pipe response stream directly
    response.data.pipe(res);

  } catch (error) {
    console.error("Error proxying Jasper Report:", error.message);
    res.status(500).send(`Failed to fetch Jasper report: ${error.message}`);
  }
};
