const mongoose = require("mongoose");
exports.getOrderSetData = async function (orguid, code) {
  let patientpackages = await mongoose.connection.db
    .collection("ordersets")
    .aggregate(
      [
        {
            $match : {
              "statusflag" : "A",
              'code' : code,
              "orguid" : mongoose.Types.ObjectId(orguid)
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
      console.log(err);
    });

  return patientpackages;
};
exports.getPatientPackagesItems = async function (orguid, ordersetuid) {
  let patientpackages = await mongoose.connection.db
    .collection("ordersets")
    .aggregate(
      [
        {
            $match : {
              "statusflag" : "A",
              '_id' : ordersetuid,
              "orguid" : mongoose.Types.ObjectId(orguid)
            }  
        },
        { $unwind: { path: "$orderitems", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "orderitems", localField: "orderitems.orderitemuid", foreignField: "_id", as: "orderitem" } },
        { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
        {
          $project : {
            'code' : "$orderitem.code",
            'name' : "$orderitem.name",
            'quantity' : "$orderitems.quantity",
            'packageitemprice' :  { $ifNull: ["$orderitems.packageitemprice", 0 ]},
            'packageitemprice' : { $ifNull: ["$orderitems.packageitemprice", 0 ]},
            'doctoritemshare' : { $ifNull: ["$orderitems.doctoritemshare", 0 ]},
            'activefrom' :  { $dateToString: { date : "$orderitems.activefrom", format : "%d/%m/%Y", timezone : "Asia/Bangkok" }},
            'activeto' :  { $dateToString: { date : "$orderitems.activeto", format : "%d/%m/%Y", timezone : "Asia/Bangkok" }},
          }
        },
        { $sort : { "sortorder" : -1}},
      ],
      { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err);
    });

  return patientpackages;
};