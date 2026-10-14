const mongoose = require("mongoose");

exports.getIPFillOrders = async function (orguid, patientuid, visituid) {
  let initfilter = {};
  initfilter.orguid = mongoose.Types.ObjectId(orguid);
  initfilter.statusflag = 'A';
  
  let pipeline = [
      { $match: initfilter },
      { $unwind: { path: "$ipfillorderitems", preserveNullAndEmptyArrays: true } },
      { $sort: { orderdate: -1 } }
  ];

  // Add an additional match stage for `ipfillorderitems.patientvisituid` if `visituid` is provided
  if (visituid) {
      pipeline.push({
          $match: {
              "ipfillorderitems.patientvisituid": mongoose.Types.ObjectId(visituid)
          }
      });
  }

  if (patientuid) {
    pipeline.push({
        $match: {
            "ipfillorderitems.patientuid": mongoose.Types.ObjectId(patientuid)
        }
    });
  }

  if(!visituid && !patientuid) {
    pipeline.push({ $limit: 50 });
  }

  // Continue with the remaining stages
  pipeline = pipeline.concat([
      { $lookup: { from: "patientvisits", localField: "ipfillorderitems.patientvisituid", foreignField: "_id", as: "patientvisits" } },
      { $lookup: { from: "patients", localField: "ipfillorderitems.patientuid", foreignField: "_id", as: "patients" } },
      { $lookup: { from: "patientorders", foreignField: "_id", localField: "ipfillorderitems.patientorderuid", as: "patientorder" } },
      { $lookup: { from: "patientorders", foreignField: "_id", localField: "ipfillorderitems.linkpatientorderuid", as: "linkpatientorder" } },
      { $lookup: { from: "inventorystores", foreignField: "_id", localField: "invstoreuid", as: "inventorystore" } },
      { $unwind: { path: '$inventorystore', preserveNullAndEmptyArrays: true } },
      { 
          $lookup: {
              from: 'referencevalues',
              let: { statusuid: "$ipfillorderitems.statusuid" },
              pipeline: [
                  { $match: { $expr: { $eq: ["$_id", "$$statusuid"] } } },
                  { $project: { valuedescription: 1 } }
              ],
              as: 'status'
          }
      },
      { 
          $lookup: {
              from: 'orderitems',
              let: { orderitemuid: "$ipfillorderitems.orderitemuid" },
              pipeline: [
                  { $match: { $expr: { $eq: ["$_id", "$$orderitemuid"] } } },
                  { $project: { code: 1, name: 1 } }
              ],
              as: 'orderitems'
          }
      },
      { $lookup: { from: "users", localField: "createdby", foreignField: "_id", as: "createdby" } },
      { $unwind: { path: "$createdby", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "users", localField: "modifiedby", foreignField: "_id", as: "modifiedby" } },
      { $unwind: { path: "$modifiedby", preserveNullAndEmptyArrays: true } },
      {
          $project: {
              // $lookup gives arrays; take the single match so the page shows a value, not ["..."]
              vn: { $ifNull: [{ $arrayElemAt: ["$patientvisits.visitid", 0] }, ""] },
              hn: { $ifNull: [{ $arrayElemAt: ["$patients.mrn", 0] }, ""] },
              orderdate: { $dateToString: { date: "$orderdate", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }},
              cutofftime: { $dateToString: { date: "$cutofftime", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }},
              status: { $ifNull: [{ $arrayElemAt: ["$status.valuedescription", 0] }, ""] },
              ipfillnumber: "$ipfillnumber",
              ordernumber: { $ifNull: [{ $arrayElemAt: ["$patientorder.ordernumber", 0] }, ""] },
              ordercode: { $ifNull: [{ $arrayElemAt: ["$orderitems.code", 0] }, ""] },
              ordername: { $ifNull: [{ $arrayElemAt: ["$orderitems.name", 0] }, ""] },
              ipfillquantity: "$ipfillorderitems.ipfillquantity",
              inventorystore: "$inventorystore.name",
              ismultiplefreq : "$ipfillorderitems.ismultiplefreq",
              createdby: "$createdby.name",
              createdat: { $dateToString: { date: "$createdat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }},
              modifiedby: "$modifiedby.name",
              modifiedat: { $dateToString: { date: "$modifiedat", format: "%d/%m/%Y %H:%M", timezone: "Asia/Bangkok" }},
              linkpatientorderuid : "$ipfillorderitems.linkpatientorderuid",
              linkpatientorderitemuid : "$ipfillorderitems.linkpatientorderitemuid",
          }
      }
  ]);

  let data = await mongoose.connection.db
      .collection("ipfillorders")
      .aggregate(pipeline, { allowDiskUse: true })
      .toArray()
      .then(function (res) {
          return res;
      })
      .catch(function (err) {
          console.log(err);
      });

  return data;
};