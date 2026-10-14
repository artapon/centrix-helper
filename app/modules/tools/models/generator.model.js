const mongoose = require("mongoose");

exports.getColectionKeys = async function (collection) {

  let colectionData = await mongoose.connection.db
    .collection(collection)
    .aggregate(
      [
        { $limit : 1 }
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

  return colectionData;
};