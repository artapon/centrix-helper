const mongoose = require("mongoose");
let moment = require("moment-timezone");
let helpers = require("../../../core/helpers/dateHelper");
exports.getPatientCreditnotes = async function (orguid, visitid, patientuid) {
  let initfilter = {};
  initfilter.orguid = mongoose.Types.ObjectId(orguid);
  initfilter.statusflag = 'A';
  
  if(visitid)
    initfilter.patientvisituid = visitid;

  if(patientuid)
    initfilter.patientuid = patientuid;
   
  let data = await mongoose.connection.db
    .collection("creditnotes")
    .aggregate(
      [
        {
               $match : initfilter
        },
        { $sort : { creditdate : -1}},
        { $limit : 50 },
        { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
        { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" } },
        { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "patientvisits.visitstatusuid", foreignField: "_id", as: "visitstatus" } },
        { $unwind: { path: "$visitstatus", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "useruid", foreignField: "_id", as: "user" } },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "userdepartmentuid", foreignField: "_id", as: "userdepart" } },
        { $unwind: { path: "$userdepart", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "cancelrefundbyuseruid", foreignField: "_id", as: "cancelrefundbyuser" } },
        { $unwind: { path: "$cancelrefundbyuser", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
        { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
        { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "approvedbyuseruid", foreignField: "_id", as: "approvedbyuser" } },
        { $unwind: { path: "$approvedbyuser", preserveNullAndEmptyArrays: true } },
        {
            $project : {
                sequencenumber : "$sequencenumber",
                creditdate : { $dateToString: { date : "$creditdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                creditdateforsort : "$creditdate",
                mrn : "$patients.mrn",
                visitid : "$patientvisits.visitid",
                visitstatus : "$visitstatus.valuedescription",
                creditamount : "$creditamount",
                amount : "$amount",
                payor : "$payors.name",
                payoragreements : "$payoragreements.name",
                user : "$user.name",
                userdepart : "$userdepart.name",
                cancelrefundbyuser : "$cancelrefundbyuser.name",
                iscancelled : "$iscancelled",
                isipdcredit : "$isipdcredit",
                isrefund : "$isrefund",
                createdby : "$createdby.name",
                createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedby : "$modifiedby.name",
                modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedatforsort :  "$modifiedat",
                approvedbyuser : "$approvedbyuser.name"
            }
        },
      ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err)
    });

  return data;
};