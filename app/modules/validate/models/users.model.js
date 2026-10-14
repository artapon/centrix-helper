const mongoose = require("mongoose");
exports.getCareproviderAll = async function (orguid) {
  let patientvisits = await mongoose.connection.db
    .collection("users")
    .aggregate(
      [
        {
            $match : {
              "statusflag" : "A",
              "iscareprovider" : true,
              "orguid" : mongoose.Types.ObjectId(orguid)
            }  
        },
        {
          $project : {
            _id : "$_id",
            name : "$name",
            defaultdepartment : "$defaultdepartment.name"
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

  return patientvisits;
};

exports.getUserByCode = async function (usercode, orguid) {
  let user = await mongoose.connection.db
    .collection("users")
    .aggregate(
      [
        {
            $match : {
              "statusflag" : "A",
              "code" : {$eq : usercode},
              "orguid" : mongoose.Types.ObjectId(orguid)
            }  
        },
        {
          $project : {
            _id : "$_id",
            code : "$code",
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

  return user;
};