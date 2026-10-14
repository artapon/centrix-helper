const mongoose = require("mongoose");

exports.getlabData = async function (labcode) {

  let labresults = await mongoose.connection.db
    .collection("labmasters")
    .aggregate(
      [
        {
            $match : {
                "code" : labcode,
                "statusflag" : 'A'
            
            }  
        },
        {
            "$unwind": {
                "path": "$resultitems",
                "preserveNullAndEmptyArrays": true
            }
        },
        {
            
            $project : {
                "resultitemuid" : "$resultitems.resultitemuid",
                "code" : "$code",
                "name" : "$name",
                "orderitemuid" : "$orderitemuid",
                "OBR_HL7_ORDER_CODE" : { $concat:["$code","^","$name"]},
                "displayorder" : "$resultitems.displayorder",
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
            $project : {
                "resultitemuid" : "$resultitems.resultitemuid",
                "code" : "$code",
                "name" : "$name",
                "resulttype" : "$resulttype",
                "resultcode" : "$orderresultitems.code",
                "resultname" : "$orderresultitems.name",
                "resulttype" : "$orderresultitems.resulttype",
                "resultuomuid"  : "$orderresultitems.uomuid",
                "orderitemuid" : "$orderitemuid",
                "OBR_HL7_ORDER_CODE" : { $concat:["$code","^","$name"]},
                "displayorder" : "$displayorder"
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
                "displayorder" : 1,
                "resultitemuid" : 1,
                "code" : 1,
                "name" : 1,
                "resultcode" : 1,
                "resultname" : 1,
                "resulttype" : 1,
                "uom" : "$referencevalues.valuedescription",
                "OBR_HL7_ORDER_CODE" : { $concat:["$code","^","$name"]},
                "OBX_HL7_RESULT_CODE" : { $concat:["$resultcode","^","$resultname","^", "$resultname"]}
            }
        },
        {
            $group: {
                 _id: {"code" : "$code", "name" : "$name", "OBR_HL7_ORDER_CODE" : "$OBR_HL7_ORDER_CODE"},
                 resultitems:{$push: {
                    displayorder : "$displayorder",
                     resultcode:"$resultcode",
                     resultname:"$resultname",
                     resulttype: "$resulttype",
                     uom:"$uom",
                     OBX_HL7_RESULT_CODE:"$OBX_HL7_RESULT_CODE"
                 }},
            }}
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

  return labresults;
};