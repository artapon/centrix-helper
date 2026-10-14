const mongoose = require("mongoose");

exports.getXrayData = async function (code) {

  let orderitems = await mongoose.connection.db
    .collection("orderitems")
    .aggregate(
      [
        {
            $match : {
                "code" : code
            
            }  
        },
        {
            $project : {
                "name" : "$name"
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

  return orderitems;
};

exports.validateModalityData = async function () {
  let orderitems = await mongoose.connection.db
    .collection("orderitems")
    .aggregate(
      [
        { $match : {statusflag : "A", activeto : null}},
        { $lookup: { from: "ordercategories", localField: "ordercatuid", foreignField: "_id", as: "ordercategories" } },
        { $unwind: { path: "$ordercategories", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "defaultmodalityuid", foreignField: "_id", as: "modality" } },
        { $unwind: { path: "$modality", preserveNullAndEmptyArrays: true } },
        { 
            $match : {
                "ordercategories.ordercattype" : "RADIOLOGY"
            }
        },
        {
            $project : {
                code : "$code",
                name : "$name",
                description : "$description",
                valuecode : {$ifNull: ["$modality.valuecode",""]},
                valuedescription : {$ifNull: ["$modality.valuedescription", ""]}
            }
        },
        { 
          $match : {
            "valuecode" : { $eq : ""}
          },
        },
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
  return orderitems;
};

exports.validateDuplicateAccessionnumber = async function (orguid) {
  let data = await mongoose.connection.db
    .collection("patientorders")
    .aggregate(
      {
        $match : {statusflag : "A", ordercattype : 'RADIOLOGY', orguid : mongoose.Types.ObjectId(orguid), "patientorderitems.accessionnumber" : {$ne: null}}
    },
    { $lookup: { from: "patients", localField: "patientuid", foreignField: "_id", as: "patients" } },
    { $unwind: { path: "$patients", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$patientorderitems", preserveNullAndEmptyArrays: true } },
    {
      $group: { 
        _id: { accessionnumber: "$patientorderitems.accessionnumber" },
        errorhn : {$addToSet: "$patients.mrn"},
        count: {$sum: 1}
      } 
    },
    {
      $match: { 
        count: {"$gt": 1}
      }
    },
    { allowDiskUse: true }
    )
    .toArray()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err);
    });

  return data;
};
