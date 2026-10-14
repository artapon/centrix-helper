const json2xls = require('json2xls');
const mongoose = require('mongoose');

const mirthConnectModel = require("../../logs/models/mirthconnect.model");
exports.index = function (req, res) {
    mirthConnectModel.getChannelMessageLogByID('29681dee-b4fb-4007-8dc5-63d7d094d320')
    res.status(200).json("OK !!");
 }
