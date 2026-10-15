# Centrix HIS Helper Tools

## Project structure (HMVC)

```
server.js                  express bootstrap: auth, session, view engine, mounts modules
app/
  core/                    shared across modules
    config/sqlite.js       local sqlite (data/app.sqlite)
    migrations/            sqlite schema
    auth.js                first-run setup code, session secret, sign-in throttling
    layout.js              sidebar / top bar / breadcrumb data for the layout
    helpers/               date.helper, auditlookup.helper, encryption, number, password (scrypt)
    http/async.handler.js
    middleware/            renderpage (res.renderPage), requireauth (+ requireAdmin), requiredbconnection, requireactiveaddon, legacyredirect (*.middleware.js)
    models/                site-wide models (organisations)
    views/                 index.html layout, partials/, shared/
    modules.js             auto-mounts every module's routes
    view.js                resolves module view paths
  modules/
    <module>/
      controllers/
      models/
      views/
      routes.open.js       (optional) no sign-in required (login, install)
      routes.public.js     (optional) signed-in users, no Mongo connection needed
      routes.js            signed-in users with a Mongo connection
addons/
  <id>/                    optional add-on (Marketplace): addon.json, controllers/, models/, views/, public/, routes*.js
```

Modules: `auth`, `billing`, `doctors`, `home`, `inventory`, `logs`, `monitor`, `orders`, `overview`,
`patients`, `reports`, `setting`, `test`, `tools`, `validate`.

### Users and sign-in

Users live in the local sqlite database (`users` table) with scrypt-hashed passwords and an
`admin` or `user` role. On first start with no users the app only serves `/install`, which
asks for a one-time setup code printed to the server console and saved in
`data/setup-code.txt`, then creates the administrator. Admins manage users at
`/admin/users`; everyone can change their own password at `/account`.

- `req.user` is the signed-in user (`req.auth.user` still holds the username).
- Access is per menu item: admins grant roles menu links at `/admin/roles`, and a request
  under a link the role lacks gets 403 (`core/permissions.js`). For routes outside the item's
  link, list their prefixes in the item's `match` array (e.g. DB Connection owns `/database/connect`).
  New menu items are granted to no role until an admin ticks them (administrators see everything).
- Guard admin-only routes with `requireAdmin` from `core/middleware/requireauth.middleware`, and mark
  admin-only menu entries with `adminOnly: true` in `menu.config.js` (never grantable to roles).
- Sessions are in memory: restarting the app signs everyone out.

### Conventions

- A model lives in the module that owns its collection. Other modules may require it
  directly, e.g. `require('../../patients/models/patient.model')`.
- Render a page with a view from the module's `views/` folder:

  ```js
  const view = require('../../../core/view')('billing');
  return res.renderPage(view('patientbills'), { title: 'Patient Bills' });
  // view.of('patients', 'summary') -> another module's view
  // view.shared('postdata')        -> app/core/views/shared
  ```

### Views (Vue 2)

Each page is a Vue 2 app. `res.renderPage(viewFile, locals)` renders the shared layout
server-side, embeds `locals` as JSON (`Page.data`) and mounts the module view as the Vue
template (`public/js/page.js`). There is no build step.

- Locals are the page's Vue data: `{{ bill.mrn }}`, `v-for="item in bills"`,
  `v-if`, `:href="`/billing/bills/${item.sequencenumber}`"`. Text is HTML-escaped; use
  `v-html` only for trusted markup.
- Dates are sent as the same string `String(date)` gave before; ObjectId/Decimal128 as strings.
- Server data is frozen for speed; reassign a top-level key to change it.
- `<script>` and `<style>` blocks in a view run/apply alongside the page. Add Vue options with:

  ```html
  <script>
    Page.setup({
      computed: { total: function () { return this.items.length; } },
      methods: { open: function (id) { /* ... */ } },
      mounted: function () { /* DOM is rendered here (charts, plugins) */ }
    });
  </script>
  ```

  Code outside `Page.setup` runs before the page is mounted, so DOM work belongs in
  `mounted` or `$(function () { ... })`.

### Adding a module

Create `app/modules/<name>/` with `controllers/`, `views/` (and `models/` if needed) and a
`routes.js` exporting an express Router. It is picked up automatically on startup.
