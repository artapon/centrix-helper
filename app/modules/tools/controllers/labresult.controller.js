const labresultModel = require("../../validate/models/labresult.model");
const patienttModel = require("../../patients/models/patient.model");
const number = require('../../../core/helpers/number');
let moment = require("moment-timezone");
const fs = require('fs');
const view = require('../../../core/view')('tools');

exports.index = async function (req, res) {
  let labcode = req.body.labcode;
  let hn = req.body.hn;
  let hl7 = ``;
  let currenttime =  moment().tz("Asia/Bangkok").format("YYYYMMDDHHmmss");
  let ordercode = req.body.ordercode;//เปลี่ยนตาม order ที่สั่ง
  let departmenttype = req.body.departmenttype;
  let departmentcode = req.body.departmentcode;
  let redirect = req.body.redirect || '';
  if(labcode && hn) {
    let patient = await patienttModel.getPatientData(hn);
    let title = patient[0].title;
    let name = patient[0].name;
    let surname = patient[0].surname;
    let gender = patient[0].gender;
    let idcard = patient[0].idcard;
    let usercode = patient[0].usercode;
    let username = patient[0].username;
    let labresults = await labresultModel.getlabData(labcode.trim());
    let i = 1;
    hl7 += `MSH|^~\&|LIS|MDT-LINK|HIS|HO_SIDA|${currenttime}||ORU^R01^ORU_R01|20240327185431-LAB-24-000897|P|2.4` + "<br>";
    hl7 += `PID|1|${hn}|${hn}||${surname}^${name}^^${title}||${idcard}|${gender}` + '<br>';
    hl7 += `PV1|1|PED^^|${departmentcode}^^|||||RPHDOCTOR^^ไม่ระบุแพทย์^^^||||||||||${departmenttype}|`+'<br>';
    hl7 +=`ORC|1|${ordercode}||${ordercode}|||||${currenttime}|^|||||||||^`+'<br>';
    labresults.forEach(result => {
      hl7 += `OBR|${i}|${ordercode}^^${ordercode}|${ordercode}|${result._id.OBR_HL7_ORDER_CODE}|R||${currenttime}|||||||${currenttime}||||||||||||||||||||INTERFACE^^INTERFACE^^^|INTERFACE^^INTERFACE^^^`+"<br>";
      i++;
      result.resultitems.forEach(resultitems => {
        if(resultitems.uom) {
          if(i <= 2) {
            hl7 += `OBX|${i}|ST|${resultitems.OBX_HL7_RESULT_CODE}||${number.randomIntFromInterval(11,16)}|${resultitems.uom}|11-16||||F|||${currenttime}||${usercode}^${username}^^^^นพ.||${currenttime}||INTERFACE^^INTERFACE^^^`+"<br>";
            hl7 += `NTE|${i}||Mock Data For Test`+"<br>";
          } else if (i > 2 && i <= 4) {
            hl7 += `OBX|${i}|ST|${resultitems.OBX_HL7_RESULT_CODE}||${number.randomIntFromInterval(1,3)}|${resultitems.uom}|1-3|L|||F|||${currenttime}||${usercode}^${username}^^^^นพ.||${currenttime}||INTERFACE^^INTERFACE^^^`+"<br>";
            hl7 += `NTE|${i}||Mock Data For Test`+"<br>";
          } else {
            hl7 += `OBX|${i}|ST|${resultitems.OBX_HL7_RESULT_CODE}||${number.randomIntFromInterval(45,75)}|${resultitems.uom}|45-75|H|||F|||${currenttime}||${usercode}^${username}^^^^นพ.||${currenttime}||INTERFACE^^INTERFACE^^^`+"<br>";
            hl7 += `NTE|${i}||Mock Data For Test`+"<br>";
          }
        } else {
          hl7 += `OBX|${i}|ST|${resultitems.OBX_HL7_RESULT_CODE}||Mockup interface result : normal||||||F|||${currenttime}||${usercode}^${username}^^^นพ.||${currenttime}||INTERFACE^^INTERFACE^^^`+"<br>";
          hl7 += `NTE|${i}||Mock Interface Data`+"<br>";
        }
        i++;
      })
    });

    const now = moment().format('YYYYMMDDHHmmss');

    if(process.env.IS_ALLOW_MOCK_DATA) {
      await fs.writeFileSync(`${process.env.ORU_MOCKUP_PATH}/${now}_${ordercode}_mock.hl7`, hl7.replace(/<br ?\/?>/g, "\n"));
    }

    
  }

  if(redirect) {
      return res.redirect('/lab/orders');
  }

  return res.renderPage(view('labresult'), {
    title:  'Centrix HIS Helper Tools',
    message: hl7
  });
};

