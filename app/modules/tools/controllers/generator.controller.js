
const _ = require('lodash');
let fs = require('fs');
const path = require('path');
let generatorModel = require("../models/generator.model");
const view = require('../../../core/view')('tools');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

exports.index =  async function(req, res) {
  let fields = [];
  let mname = "";
  let cname = "";
  let name = "";
  let jwt = "";
  let model = "";
  let project = "";
  let controller = "";
  let routeFile = 'routes/v1/public.api.js';
  let route = "";
  let yaml = "";
  let type1 = "";
  let type2 = "";
  let type3 = "";
  let type4 = "";
  name = req.query.name ? _.camelCase(req.query.name) : '';
  cname = 'src/controllers/api/'+ name +'Controller.js';
  mname = 'src/models/'+ name +'Model.js';
  let ptype = req.query.ptype || '';
  jwt = req.query.jwt || '';

  if(jwt == 'yes') 
    routeFile =  'routes/v1/private.api.js';

  let p1 = req.query.p1 ? _.camelCase(req.query.p1) : '';
  let p2 = req.query.p1 ? _.camelCase(req.query.p2) : '';
  let p3 = req.query.p1 ? _.camelCase(req.query.p3) : '';
  let p4 = req.query.p1 ? _.camelCase(req.query.p4) : '';

  let dcollection = req.query.dcollection ? (req.query.dcollection).toLowerCase() : '';
  let keys = [];
  if(dcollection) {
    fields = await generatorModel.getColectionKeys(dcollection);
    fields = fields[0];
    if(fields) 
    {
        Object.keys(fields).forEach(key => {
          if (!keys.includes(key)) {
            if(key !== 'id' && key != '__v') 
            {
              project += `"${key}" : "\$${key}",\n`;

              if(fields[key] && typeof fields[key] === 'object') {
                  Object.keys(fields[key]).forEach(subkey => {
                    if(subkey != '_bsontype' && subkey != 'id' && subkey != '__v')
                    project += `"${key}_${subkey}" : "\$${key}.${subkey}",\n`
                  })
              }
            }
          }
        });
    }

    model = fs.readFileSync(path.join(TEMPLATES_DIR, "model.txt"), 'utf8');
    model = model.replace(/{fields}/g, project);
    model = model.replace(/{dcollection}/g, dcollection);
    model = model.replace(/{name}/g, name);

    controller = fs.readFileSync(path.join(TEMPLATES_DIR, "controller.txt"), 'utf8');
    controller = controller.replace(/{name}/g, name);

    route = fs.readFileSync(path.join(TEMPLATES_DIR, "route.txt"), 'utf8');
    route = route.replace(/{name}/g, name);
    route = route.replace(/{medthod}/g, ptype == 'query' || 'get' ? 'get' : 'post');

    route = fs.readFileSync(path.join(TEMPLATES_DIR, "route.txt"), 'utf8');
    route = route.replace(/{name}/g, name);
    route = route.replace(/{medthod}/g, ptype == 'query' || 'get' ? 'get' : 'post');

    if(ptype == 'post')
      yaml = fs.readFileSync(path.join(TEMPLATES_DIR, "apiyaml_post.txt"), 'utf8');
    else
      yaml = fs.readFileSync(path.join(TEMPLATES_DIR, "apiyaml_get.txt"), 'utf8');

    if(p1 != "")
       type1 = 'string';
    if(p2 != "")
       type2 = 'string';
    if(p3 != "")
       type3 = 'string';
    if(p4 != "")
       type4 = 'string';

    yaml = yaml.replace(/{name}/g, name);
    yaml = yaml.replace(/{prop1}/g, p1);
    yaml = yaml.replace(/{typep1}/g, type1);
    yaml = yaml.replace(/{prop2}/g, p2);
    yaml = yaml.replace(/{typep2}/g, type2);
    yaml = yaml.replace(/{prop3}/g, p3);
    yaml = yaml.replace(/{typep3}/g, type3);
    yaml = yaml.replace(/{prop4}/g, p4);
    yaml = yaml.replace(/{typep4}/g, type4);

  }

  return res.renderPage(view('generator'), {
      title:  'API Generator',
      cname : cname,
      mname : mname,
      routeFile : routeFile,
      model : model,
      controller : controller,
      route : route,
      yaml : yaml
    });
};
