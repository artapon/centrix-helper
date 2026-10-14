const mongoose = require("mongoose");

exports.getBedtransfers = async function (orguid, visituid, patientuid) {
  let initfilter = {};
  initfilter.statusflag = 'A'
  initfilter.orguid =  mongoose.Types.ObjectId(orguid);

  if(visituid)
    initfilter._id = visituid;

  if(patientuid)
    initfilter.patientuid = patientuid;
  let bedtransfers = await mongoose.connection.db
    .collection("bedtransfers")
    .aggregate(
        [
            {
                $match : initfilter
            },
            { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
            { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" } },
            { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "wards", localField: "sourcewarduid", foreignField: "_id", as: "swards" } },
            { $unwind: { path: "$swards", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "beds", localField: "sourcebeduid", foreignField: "_id", as: "sbeds" } },
            { $unwind: { path: "$sbeds", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "wards", localField: "destwarduid", foreignField: "_id", as: "dwards" } },
            { $unwind: { path: "$dwards", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "beds", localField: "destbeduid", foreignField: "_id", as: "dbeds" } },
            { $unwind: { path: "$dbeds", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "wards", localField: "transferredwarduid", foreignField: "_id", as: "twards" } },
            { $unwind: { path: "$twards", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "beds", localField: "transferredbeduid", foreignField: "_id", as: "tbeds" } },
            { $unwind: { path: "$tbeds", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "users", localField: "bookedby", foreignField: "_id", as: "bookedby" } },
            { $unwind: { path: "$bookedby", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "referencevalues", localField: "statusuid", foreignField: "_id", as: "statusuid" } },
            { $unwind: { path: "$statusuid", preserveNullAndEmptyArrays: true } },
            {
              $project : {
                visitid : "$patientvisits.visitid",
                hn : "$patients.mrn",
                swardscode : "$swards.code",
                swardsname : "$swards.name",
                sbedscode : "$sbeds.code",
                sbedsname : "$sbeds.name",
                dwardscode : "$dwards.code",
                dwardsname : "$dwards.name",
                dbedscode : "$dbeds.code",
                dbedsname : "$dbeds.name",
                twardscode : "$twards.code",
                twardsname : "$twards.name",
                tbedscode : "$tbeds.code",
                tbedsname : "$tbeds.name",
                statusuid : "$statusuid.valuedescription",
                isactive : "$isactive",
                isolationrequired : "$isolationrequired",
                retaincurrentbed : "$retaincurrentbed",
                islodgerbed : "$islodgerbed",
                ischangedept : "$ischangedept",
                bookedby : "$bookedby.name",
                bookedat : { $dateToString: { date : "$bookedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                dateforsort : "$bookedat"
              }
            },
            { $sort : {dateforsort : -1} }
        ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      res.status(200).json(err);
    });

  return bedtransfers;
};