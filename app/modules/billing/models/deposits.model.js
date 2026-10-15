const mongoose = require("mongoose");
const paging = require('../../../core/http/paging');        // optional Previous / Next paging of the list pages
let moment = require("moment-timezone");
let helpers = require("../../../core/helpers/date.helper");
exports.getPatientDeposites = async function (orguid, visitid, patientuid, page = null) {
  let initfilter = {};
  initfilter.orguid = mongoose.Types.ObjectId(orguid);
  initfilter.statusflag = 'A';
  
  if(visitid)
    initfilter.patientvisituid = visitid;

  if(patientuid)
    initfilter.patientuid = patientuid;

  let data = await mongoose.connection.db
    .collection("deposits")
    .aggregate(
      [
        {
            $match : initfilter
        },
        { $sort : { depositdate : -1, _id : -1 }},
        ...paging.stages(page, 50),
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
        { $lookup: { from: "referencevalues", localField: "paymentmodeuid", foreignField: "_id", as: "paymentmode" } },
        { $unwind: { path: "$paymentmode", preserveNullAndEmptyArrays: true } },
        {
            $project : {
                sequencenumber : "$sequencenumber",
                depositdate : { $dateToString: { date : "$depositdate", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                depositdateforsort : "$depositdate",
                mrn : "$patients.mrn",
                visitid : {$ifNull: ["$patientvisits.visitid", ""]},
                visitstatus : "$visitstatus.valuedescription",
                paidamount : "$paidamount",
                amount : "$amount",
                payor : "$payors.name",
                payoragreements : "$payoragreements.name",
                user : "$user.name",
                userdepart : "$userdepart.name",
                cancelrefundbyuser : "$cancelrefundbyuser.name",
                isrefund : "$isrefund",
                iscancelled : "$iscancelled",
                isipddeposit : "$isipddeposit",
                isduetobillcancel : {$ifNull: ["$isduetobillcancel", ""]},
                isrefund : "$isrefund",
                createdby : "$createdby.name",
                createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedby : "$modifiedby.name",
                modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                dateforsort :  "$depositdate",
                paymentmode : "$paymentmode.valuedescription"
            }
        }
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