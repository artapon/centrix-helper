const mongoose = require("mongoose");

exports.getNewbornDetailsData = async function (orguid, visituid, patientuid) {
  let initfilter = {};
  initfilter.statusflag = 'A'
  initfilter.orguid =  mongoose.Types.ObjectId(orguid);

  if(visituid)
    initfilter._id = visituid;

  if(patientuid)
    initfilter.patientuid = patientuid;

  let newbornDetails = await mongoose.connection.db
    .collection("newborndetails")
    .aggregate(
      [
        {
            $match : initfilter
        },
        { $lookup: { from: "patients", localField: "babypatientuid", foreignField: "_id", as: "babypatients" } },
        { $unwind: { path: "$babypatients", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "patientvisits", localField: "patientvisituid", foreignField: "_id", as: "patientvisits" } },
        { $unwind: { path: "$patientvisits", preserveNullAndEmptyArrays: true } },
        {
          $project : {
            'hn' : "$babypatients.mrn",
            'visitid' : "$patientvisits.visitid",
            'isogtube' : "$isogtube",
            'isbonding' : "$isbonding",
            'istrachialsuction' : "$istrachialsuction",
            'isoxygen' : "$isoxygen",
            'isppvncpap' : "$isppvncpap",
            'isretainedettube' : "$isretainedettube",
            'ischestcompression' : "$ischestcompression"
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
      res.status(200).json(err);
    });

  return newbornDetails;
};
