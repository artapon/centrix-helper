const xrayModel = require("../../validate/models/xray.model");
const patienttModel = require("../../patients/models/patient.model");
let moment = require("moment-timezone");
const fs = require('fs');
const view = require('../../../core/view')('tools');

exports.index = async function (req, res) {
  let hn = req.body.hn;
  let hl7 = ``;
  let currenttime =  moment().tz("Asia/Bangkok").format("YYYYMMDDHHmmss");
  let ordercode = req.body.xraycode;//เปลี่ยนตาม order ที่สั่ง
  let ordernumber = req.body.ordernumber;
  let departmenttype = req.body.departmenttype;
  let departmentcode = req.body.departmentcode;
  let visitid = req.body.visitid;
  let accessionnumber = req.body.accessionnumber;
  let result = req.body.result;
  let orderpriority = "";
  if(ordercode && hn) {
    let patient = await patienttModel.getPatientData(hn);
    let xrayorder = await xrayModel.getXrayData(ordercode);
    let name = patient[0].name;
    let title = patient[0].title;
    let surname = patient[0].surname;
    let gender = patient[0].gender;
    let idcard = patient[0].idcard;
    let nameeng = patient[0].nameeng;
    let surnameeng = patient[0].surnameeng;
    let dob = patient[0].dob;
    let mobile = patient[0].mobile;

    hl7 += `MSH|^~\&|CARESTREAM|2|||${currenttime}||ORU^R01|165036|P|2.3`  + "<br>";
    hl7 += `PID|||${hn}||${name}^${surname}||${dob}|${gender}` + "<br>";
    hl7 += `OBR|||${accessionnumber}|${xrayorder[0].name}}||||||||||||^^NAIPHAET THOTSOP ( NAM SOMMUT )^NAIPHAET THOTSOP ( NAM SOMMUT )||${currenttime}|||||||A|||||||304190^Suppattra  ^Pinprapaporn` + "<br>";
    hl7 += `OBX||TX|${ordercode}^${xrayorder[0].name}||interfaced result : ${result}||||||F|||${currenttime}||086160` + '<br>';

    await fs.writeFileSync(`tmp_hl7/${ordercode}_for_test.hl7`, hl7.replace(/<br ?\/?>/g, "\n"));
    await res.attachment(`tmp_hl7/${ordercode}_for_test.hl7`);


    //Standard format
    // hl7 += `MSH|^~\&|RIS|CARESTREAM|2|Rachaphruek hospital (Dev)|${currenttime}||ORU^R01|ORU_${currenttime}|P|2.3|1||AL` + "<br>";
    // hl7 += `PID|1||${hn}||${surname}^${name}||||${dob}|${gender}|${surnameeng}^${nameeng}^null|||||||||${mobile}|||||${idcard}` + '<br>';
    //hl7 += `PV1|1|${departmenttype == 'OPD' ? 'OP' : "IP"}|${departmentcode}^||||||||||||||||${visitid}` + '<br>';
    //hl7 += `ORC|NW|${ordernumber}||||||||||086160^วิวัฒน์พัฒนกุล^ไกรสร|||||00057^Rachaphruek hospital (Dev)|||||||` + '<br>';
    //hl7 += `OBR|1|${accessionnumber}||${ordercode}^${xrayorder[0].name}}|${orderpriority}||||||||||${xrayorder[0].name}|||CR|${ordercode}|SPSLocation|CR|||CR||||||||||||${currenttime}|||||||||` + '<br>';
    //hl7 += `OBX||TX|${ordercode}^${xrayorder[0].name}||interfaced result : ${result}||||||F|||${currenttime}||086160` + '<br>';
  }

  return res.renderPage(view('xrayresult'), {
    title:  'Centrix HIS Helper Tools',
    message: hl7
  });
};