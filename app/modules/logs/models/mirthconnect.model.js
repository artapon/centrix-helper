const axios = require('axios');
const { Console } = require('winston/lib/winston/transports');
const { parseString } = require('xml2js');
const https = require('https');
let moment = require("moment-timezone");
// Create an instance of the HTTPS agent with rejectUnauthorized set to false
const agent = new https.Agent({ rejectUnauthorized: false });
// Set up the base URL of your Mirth Connect server
const baseURL = `https://${process.env.MIRTH_IP}:${process.env.MIRTH_HTTPS_PORT || 8443}/api/`;

// Define the login endpoint
const loginEndpoint = 'users/_login';

exports.parseXml = function (xml) {
    return new Promise((resolve, reject) => {
      parseString(xml, { trim: true, explicitArray: false }, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

exports.getChannelMessageLogByID = async function(channelID, PATIENTMRN = '', orderstatus = '', limit = 200) {
    let items = [];
    // Send POST request to Mirth Connect API login endpoint
    const response = await axios.post(baseURL + loginEndpoint, {
        username: process.env.MIRTH_USERNAME,
        password: process.env.MIRTH_PASSWORD
      }, {
        httpsAgent: agent, // Use the custom HTTPS agent
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
    let data = response.data;
    let session = response.headers['set-cookie'];
    session = session[0].split(';')[0];
    let status = null;
    if(data) {
        status = data['com.mirth.connect.model.LoginStatus'].status;
        if(status == 'SUCCESS') {
            let params = {};

            if(orderstatus == 'ERROR') {
              params = {
                status: 'ERROR',
                textSearch: `${PATIENTMRN}`,
                error: false,
                includeContent: true,
                offset: 0,
                limit: limit
              };
            } else if (orderstatus == 'SENT') {
              params = {
                status: 'SENT',
                textSearch: `${PATIENTMRN}`,
                error: false,
                includeContent: true,
                offset: 0,
                limit: limit
              };
            } 

            const headers = {
                'Accept': 'application/xml',
                'Cookie': session
            };
            const response2 = await axios.get(`${baseURL}channels/${channelID}/messages`, {
                params: params,
                httpsAgent: agent,
                headers: headers
            });

            results = await exports.parseXml(response2.data);
            if(results.list) {
              if((results.list.message).length > 1) {
                results.list.message.forEach(function(result) {
                    resultFormat = {
                        'Accessionnumber' : result.connectorMessages.entry.connectorMessage.channelMapContent.content.entry ? result.connectorMessages.entry.connectorMessage.channelMapContent.content.entry[3].string[1] : "",
                        'PatientHN' : result.connectorMessages.entry.connectorMessage.channelMapContent.content.entry ? result.connectorMessages.entry.connectorMessage.channelMapContent.content.entry[2].string[1] : "",
                        'channelName' : result.connectorMessages.entry.connectorMessage.channelName,
                        'connectorName' : result.connectorMessages.entry.connectorMessage.connectorName,
                        'SourceName' : result.connectorMessages.entry.connectorMessage.channelMapContent.content.entry ? result.connectorMessages.entry.connectorMessage.channelMapContent.content.entry[0].string[1] : "",
                        'DoctorCode' : result.connectorMessages.entry.connectorMessage.channelMapContent.content.entry ? result.connectorMessages.entry.connectorMessage.channelMapContent.content.entry[1].string[1] : "",
                        'status' : result.connectorMessages.entry.connectorMessage.status,
                        'ErrorMessage' : result.connectorMessages.entry.connectorMessage.responseMapContent.content.entry ? result.connectorMessages.entry.connectorMessage.responseMapContent.content.entry.response.message ? Buffer.from((result.connectorMessages.entry.connectorMessage.responseMapContent.content.entry.response.message).replace(/\r\n/g, ""), "base64").toString("utf-8") : result.connectorMessages.entry.connectorMessage.responseMapContent.content.entry.response.error : " Tranform Data Error",
                        'receivedDateTime': result.connectorMessages.entry.connectorMessage.responseDate.time ? moment(new Date(parseInt(result.connectorMessages.entry.connectorMessage.responseDate.time)).toLocaleString(), 'M/D/YYYY, h:mm:ss A').format('DD/MM/YYYY HH:mm:ss')  : ""
                    };
                  items.push(resultFormat);
                })
              } else {
                resultFormat = {
                  'Accessionnumber' : results.list.message.connectorMessages.entry.connectorMessage.channelMapContent.content.entry ? results.list.message.connectorMessages.entry.connectorMessage.channelMapContent.content.entry[3].string[1] : "",
                  'PatientHN' : results.list.message.connectorMessages.entry.connectorMessage.channelMapContent.content.entry ? results.list.message.connectorMessages.entry.connectorMessage.channelMapContent.content.entry[2].string[1] : "",
                  'channelName' : results.list.message.connectorMessages.entry.connectorMessage.channelName,
                  'connectorName' : results.list.message.connectorMessages.entry.connectorMessage.connectorName,
                  'SourceName' : results.list.message.connectorMessages.entry.connectorMessage.channelMapContent.content.entry ? results.list.message.connectorMessages.entry.connectorMessage.channelMapContent.content.entry[0].string[1] : "",
                  'DoctorCode' : results.list.message.connectorMessages.entry.connectorMessage.channelMapContent.content.entry ? results.list.message.connectorMessages.entry.connectorMessage.channelMapContent.content.entry[1].string[1] : "",
                  'status' : results.list.message.connectorMessages.entry.connectorMessage.status,
                  'ErrorMessage' : results.list.message.connectorMessages.entry.connectorMessage.responseMapContent.content.entry ? results.list.message.connectorMessages.entry.connectorMessage.responseMapContent.content.entry.response.message ? Buffer.from((results.list.message.connectorMessages.entry.connectorMessage.responseMapContent.content.entry.response.message).replace(/\r\n/g, ""), "base64").toString("utf-8") : results.list.message.connectorMessages.entry.connectorMessage.responseMapContent.content.entry.response.error : " Tranform Data Error",
                  'receivedDateTime': results.list.message.connectorMessages.entry.connectorMessage.responseDate.time ? moment(new Date(parseInt(results.list.message.connectorMessages.entry.connectorMessage.responseDate.time)).toLocaleString(), 'M/D/YYYY, h:mm:ss A').format('DD/MM/YYYY HH:mm:ss')  : ""
                };
                items.push(resultFormat);
              }
          }
        }
    }    
    return items;
}