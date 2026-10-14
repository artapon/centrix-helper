const mongoose = require("mongoose");
exports.getDFShareItem = async function (code, orguid) {

  let orderitems = await mongoose.connection.db
    .collection("orderitems")
    .aggregate(
      [
        {
            $match : {
              orguid : mongoose.Types.ObjectId(orguid),
              "code" : code,
              "statusflag" : "A"
            }  
        },
        {
            $project : {
                "isdoctorshareitem" : "$isdoctorshareitem"
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

exports.getItemMasterOrderitems = async function (orguid) {
  let itemmasters = await mongoose.connection.db
    .collection("itemmasters")
    .aggregate(
      [
        { $match : { 
            orguid : mongoose.Types.ObjectId(orguid),
            statusflag : "A",
            activeto : null,
            orderitemuid : {$ne : null}
        } },
        { $lookup: { from: "referencevalues", localField: "itemtypeuid", foreignField: "_id", as: "type" } },
        { $unwind: { path: "$type", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "purchasinguomuid", foreignField: "_id", as: "puom" } },
        { $unwind: { path: "$puom", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitem" } },
        { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "ordercategories", localField: "orderitem.ordercatuid", foreignField: "_id", as: "ordercat" } },
        { $unwind: { path: "$ordercat", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "ordercategories", localField: "orderitem.ordersubcatuid", foreignField: "_id", as: "ordersubcat" } },
        { $unwind: { path: "$ordersubcat", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "tariffs", localField: "orderitemuid", foreignField: "orderitemuid", as: "tariffs" } },
        {
            $project: {
                "ODERITEMCODE" : "$orderitem.code",
                "ORDERITEMNAME" : "$orderitem.name",
                "ITEMMASTERCOED" : "$code",
                "ITEMMASTERNAME" : "$name",
                "ORDERCATEGORYNAME" : "$ordercat.name",
                "ORDERSUBCATEGORYNAME" : "$ordersubcat.name",
                "ITEMTYPE" : "$type.valuedescription",
                "tariff" : {$arrayElemAt: ["$tariffs", 0]},
                "UNIT-DES" : "$puom.valuedescription"
            }
        },
        {
            $project: {
                _id : 0,
                "ODERITEMCODE" : 1,
                "ORDERITEMNAME" : 1,
                "ITEMMASTERCOED" : 1,
                "ITEMMASTERNAME" : 1,
                "ORDERCATEGORYNAME" : 1,
                "ORDERSUBCATEGORYNAME" : 1,
                "ITEMTYPE" : 1,
                "PRICEORDER" : "$tariff.unitprice",
                "DF-SHARE" : { $ifNull: [ "$tariff.doctorshare", "" ]},
                "UNIT-DES" : 1
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

  return itemmasters;
};

exports.getItemMasterNoOrderitems = async function (orguid) {
  let itemmasters = await mongoose.connection.db
    .collection("itemmasters")
    .aggregate(
      [
        { $match : { 
            orguid : mongoose.Types.ObjectId(orguid),
            statusflag : "A",
            activeto : null,
            orderitemuid : {$eq : null}
        } },
        { $lookup: { from: "referencevalues", localField: "itemtypeuid", foreignField: "_id", as: "type" } },
        { $unwind: { path: "$type", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "referencevalues", localField: "purchasinguomuid", foreignField: "_id", as: "puom" } },
        { $unwind: { path: "$puom", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "orderitems", localField: "orderitemuid", foreignField: "_id", as: "orderitem" } },
        { $unwind: { path: "$orderitem", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "ordercategories", localField: "orderitem.ordercatuid", foreignField: "_id", as: "ordercat" } },
        { $unwind: { path: "$ordercat", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "ordercategories", localField: "orderitem.ordersubcatuid", foreignField: "_id", as: "ordersubcat" } },
        { $unwind: { path: "$ordersubcat", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "tariffs", localField: "orderitemuid", foreignField: "orderitemuid", as: "tariffs" } },
        {
            $project: {
                "ODERITEMCODE" : { $ifNull: ["$orderitem.code", ""]},
                "ORDERITEMNAME" :  { $ifNull: ["$orderitem.name", ""]},
                "ITEMMASTERCOED" : "$code",
                "ITEMMASTERNAME" : "$name",
                "ORDERCATEGORYNAME" : { $ifNull: ["$ordercat.name", ""]},
                "ORDERSUBCATEGORYNAME" : { $ifNull: ["$ordersubcat.name",""]},
                "ITEMTYPE" : "$type.valuedescription",
                "tariff" : {$arrayElemAt: ["$tariffs", 0]},
                "UNIT-DES" : "$puom.valuedescription"
            }
        },
        {
            $project: {
                _id : 0,
                "ODERITEMCODE" : 1,
                "ORDERITEMNAME" : 1,
                "ITEMMASTERCOED" : 1,
                "ITEMMASTERNAME" : 1,
                "ORDERCATEGORYNAME" : 1,
                "ORDERSUBCATEGORYNAME" : 1,
                "ITEMTYPE" : 1,
                "PRICEORDER" : "$tariff.unitprice",
                "DF-SHARE" : { $ifNull: [ "$tariff.doctorshare", "" ]},
                "UNIT-DES" : 1
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

  return itemmasters;
};

exports.getOrderitemsNoItemMasters = async function (orguid) {
  let itemmasters = await mongoose.connection.db
    .collection("orderitems")
    .aggregate(
      [
        { $match : { 
            orguid : mongoose.Types.ObjectId(orguid),
            statusflag : "A",
            activeto : null
        } },
         { $lookup: { from: "itemmasters", localField: "_id", foreignField: "orderitemuid", as: "itemmaster" } },
         { $unwind: { path: "$itemmaster", preserveNullAndEmptyArrays: true } },
         { $lookup: { from: "ordercategories", localField: "ordercatuid", foreignField: "_id", as: "ordercat" } },
        { $unwind: { path: "$ordercat", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "ordercategories", localField: "ordersubcatuid", foreignField: "_id", as: "ordersubcat" } },
        { $unwind: { path: "$ordersubcat", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "tariffs", localField: "_id", foreignField: "orderitemuid", as: "tariffs" } },
        { $match : { 
            "itemmaster.code" : {$eq : null}
        } },
         {
            $project: {
                "ODERITEMCODE" : { $ifNull: ["$code", ""]},
                "ORDERITEMNAME" :  { $ifNull: ["$name", ""]},
                "ITEMMASTERCOED" : { $ifNull: ["$itemmaster.code", ""]},
                "ITEMMASTERNAME" : { $ifNull: ["$itemmaster.name", ""]},
                "ORDERCATEGORYNAME" : { $ifNull: ["$ordercat.name", ""]},
                "ORDERSUBCATEGORYNAME" : { $ifNull: ["$ordersubcat.name",""]},
                "ITEMTYPE" : { $ifNull: ["$type.valuedescription", ""]},
                "tariff" : {$arrayElemAt: ["$tariffs", 0]},
                "UNIT-DES" : { $ifNull: ["$puom.valuedescription", ""]}
            }
        },
        {
            $project: {
                _id : 0,
                "ODERITEMCODE" : 1,
                "ORDERITEMNAME" : 1,
                "ITEMMASTERCOED" : 1,
                "ITEMMASTERNAME" : 1,
                "ORDERCATEGORYNAME" : 1,
                "ORDERSUBCATEGORYNAME" : 1,
                "ITEMTYPE" : 1,
                "PRICEORDER" : "$tariff.unitprice",
                "DF-SHARE" : { $ifNull: [ "$tariff.doctorshare", "" ]},
                "UNIT-DES" : 1
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

  return itemmasters;
};