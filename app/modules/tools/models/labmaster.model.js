const mongoose = require("mongoose");

exports.getlabMasterData = async function (labcode) {
  let search = {};
  if(labcode)
    search.code = labcode;
    
  let labresults = await mongoose.connection.db
    .collection("labmasters")
    .aggregate(
    [
        {
            $match : {
                "statusflag" : "A",
                "orguid" : mongoose.Types.ObjectId('59e865c8ab5f11532bab0537')
            }  
        },
        {
            "$unwind": {
                "path": "$specimeninstructions",
                "preserveNullAndEmptyArrays": true
            }
        },
        {
            "$unwind": {
                "path": "$resultitems",
                "preserveNullAndEmptyArrays": true
            }
        },
        { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
        { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
        { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
        {
            
            $project : {
                "resultitemuid" : "$resultitems.resultitemuid",
                "code" : "$code",
                "name" : "$name",
                "orderitemuid" : "$orderitemuid",
                "specimenuid" : "$specimeninstructions.specimenuid",
                createdby : "$createdby.name",
                createdat : { $dateToString: { date : "$createdat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
                modifiedby : "$modifiedby.name",
                modifiedat : { $dateToString: { date : "$modifiedat", format : "%d/%m/%Y %H:%M", timezone : "Asia/Bangkok" }},
            }
        },
        {
            "$lookup": {
                "from": "specimens",
                "localField": "specimenuid",
                "foreignField": "_id",
                "as": "specimens"
            }
        },
        {
            "$unwind": {
                "preserveNullAndEmptyArrays": true,
                "path": "$specimens"
            }
        },
        {
            "$lookup": {
                "from": "orderresultitems",
                "localField": "resultitemuid",
                "foreignField": "_id",
                "as": "orderresultitems"
            }
        },
        {
            "$unwind": {
                "preserveNullAndEmptyArrays": true,
                "path": "$orderresultitems"
            }
        },
        {
            "$lookup": {
                "from": "orderitems",
                "localField": "orderitemuid",
                "foreignField": "_id",
                "as": "orderitems"
            }
        },
        {
            "$unwind": {
                "preserveNullAndEmptyArrays": true,
                "path": "$orderitems"
            }
        },
        {
            "$lookup": {
                "from": "ordercategories",
                "localField": "orderitems.ordersubcatuid",
                "foreignField": "_id",
                "as": "ordercategories"
            }
        },
        {
            "$unwind": {
                "preserveNullAndEmptyArrays": true,
                "path": "$ordercategories"
            }
        },
        {
            $project : {
                "code" : "$code",
                "name" : "$name",
                "ordersubcat" : "$ordercategories.name",
                "resultitem" : "$orderresultitems.code",
                "resultitemname" : "$orderresultitems.name",
                "typeresultitem" : "$orderresultitems.resulttype",
                "valueranges" : "$orderresultitems.valueranges",
                "specimens" : "$specimens.name",
                "resultuomuid" : "$orderresultitems.uomuid",
                createdby : 1,
                createdat : 1,
                modifiedby : 1,
                modifiedat : 1
                }
        },
        {
            "$lookup": {
                "from": "referencevalues",
                "localField": "resultuomuid",
                "foreignField": "_id",
                "as": "referencevalues"
            }
        },
        {
            "$unwind": {
                "preserveNullAndEmptyArrays": true,
                "path": "$referencevalues"
            }
        },
        {
            $project : {
                "code" : 1,
                "name" : 1,
                "ordersubcat" : 1,
                "resultitem" : 1,
                "resultitemname" : 1,
                "valueranges_m": { $arrayElemAt: [{
                    $filter: {
                        input: "$valueranges",
                        as: "valueranges",
                        cond: { $eq: [ "$$valueranges.genderuid", mongoose.Types.ObjectId("59eeee62a277d1052ea6463b") ] }
                    }
                    }, 0]},
                "valueranges_f": { $arrayElemAt: [{
                    $filter: {
                        input: "$valueranges",
                        as: "valueranges",
                        cond: { $eq: [ "$$valueranges.genderuid", mongoose.Types.ObjectId("59eeee62a277d1052ea6463c") ] }
                    }
                    }, 0]},
                "typeresultitem" : 1,
                "specimens" : 1,
                "uomname" : "$referencevalues.valuedescription",
                createdby : 1,
                createdat : 1,
                modifiedby : 1,
                modifiedat : 1
                }
        },
        {
            $project : {
                "_id" : 0,
                "code" : 1,
                "name" : 1,
                "ordersubcat" : 1,
                "resultitem" : 1,
                "resultitemname" : 1,
                "normalstart_male": {$ifNull: ["$valueranges_m.normalrangestart",""]},
                "normalend_male": {$ifNull: ["$valueranges_m.normalrangeend", ""]},
                "normalstart_female": {$ifNull: ["$valueranges_f.normalrangestart", ""]},
                "normalend_female": {$ifNull: ["$valueranges_f.normalrangeend", ""]},
                "typeresultitem" : 1,
                "specimens" : 1,
                "uomname" : {$ifNull: ["$uomname",""]},
                createdby : 1,
                createdat : 1,
                modifiedby : 1,
                modifiedat : 1
                }
        },
        { $match : search },
        {$sort : {"code" : -1}}
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

  return labresults;
};
