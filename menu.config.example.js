// Example sidebar menu: copy to menu.config.js. Grouped by data domain. Each item's link is also its permission in Roles &
// Permissions and owns every URL under it (see app/core/permissions.js and app/core/routeMap.js).
// Add-on sections (Query Studio, Jasper Printout) and Marketplace are added by app/core/addons.js.
const menu = [
  {
    header: "Dashboard",
    icon: "fas fa-th-large",
    items: [
      { text: "Overview", icon: "fas fa-chart-pie", link: "/overview", active: true }
    ]
  },
  {
    header: "Database",
    icon: "fas fa-server",
    items: [
      {
        text: "Manage Connections",
        icon: "fas fa-list",
        link: "/database/connections",
        match: ["/api/database/connections"],   // editor API (returns connection details)
        active: true
      },
      {
        text: "DB Info",
        icon: "fas fa-plug",
        link: "/database/info",
        match: ["/database/connect"],   // connecting to a site
        active: true
      },
      { text: "DB Monitor", icon: "fas fa-tachometer-alt", link: "/database/monitor", active: true }
    ]
  },
  {
    header: "Patients",
    icon: "fas fa-user-injured",
    items: [
      { text: "Patient Summary", icon: "fas fa-id-card", link: "/patients/summary", active: true },
      { text: "Patient Visits", icon: "fas fa-hospital-user", link: "/patients/visits", active: true },
      { text: "Patient Merges", icon: "fas fa-compress-arrows-alt", link: "/patients/merges", active: true },
      { text: "Doctor Active Visits", icon: "fas fa-user-md", link: "/patients/doctor-visits", active: true }
    ]
  },
  {
    header: "Laboratory (LIS)",
    icon: "fas fa-microscope",
    items: [
      { text: "Lab Master", icon: "fas fa-flask", link: "/lab/master", active: true },
      { text: "Lab Orders", icon: "fas fa-clipboard-list", link: "/lab/orders", active: true },
      { text: "Validate Lab Result", icon: "fas fa-vial", link: "/lab/result-check", active: true }
    ]
  },
  {
    header: "Radiology (RIS)",
    icon: "fas fa-x-ray",
    items: [
      { text: "Empty Default Modality", icon: "fas fa-x-ray", link: "/radiology/default-modality", active: true },
      { text: "Xray Orders", icon: "fas fa-clipboard", link: "/radiology/orders", active: true },
      { text: "Xray Mirth Log (ORM)", icon: "fas fa-stream", link: "/radiology/mirth-log/orm", active: true },
      { text: "Xray Mirth Log (ORU)", icon: "fas fa-stream", link: "/radiology/mirth-log/oru", active: true }
    ]
  },
  {
    header: "Pharmacy",
    icon: "fas fa-pills",
    items: [
      { text: "Orders Tracking", icon: "fas fa-shipping-fast", link: "/pharmacy/orders", active: true },
      { text: "Medsadmins", icon: "fas fa-syringe", link: "/pharmacy/meds-admin", active: true },
      { text: "IP Fill Orders", icon: "fas fa-dolly", link: "/pharmacy/ip-fill-orders", active: true }
    ]
  },
  {
    header: "Diet",
    icon: "fas fa-apple-alt",
    items: [
      { text: "Patient Diets", icon: "fas fa-utensils", link: "/diet/orders", active: true }
    ]
  },
  {
    header: "Billing",
    icon: "fas fa-file-invoice-dollar",
    items: [
      { text: "Patient Orders", icon: "fas fa-receipt", link: "/billing/patient-orders", active: true },
      { text: "Patient Bills", icon: "fas fa-file-invoice-dollar", link: "/billing/bills", active: true },
      { text: "Patient Chargecodes", icon: "fas fa-dollar-sign", link: "/billing/charge-codes", active: true },
      { text: "Patient Deposits", icon: "fas fa-piggy-bank", link: "/billing/deposits", active: true },
      { text: "Patient Credit Notes", icon: "fas fa-credit-card", link: "/billing/credit-notes", active: true }
    ]
  },
  {
    header: "Inventory",
    icon: "fas fa-warehouse",
    items: [
      { text: "Inventory Tracking", icon: "fas fa-boxes", link: "/inventory/tracking", active: true },
      { text: "Available Itemmasters", icon: "fas fa-tags", link: "/inventory/available-items", active: true },
      { text: "Itemmasters", icon: "fas fa-list-alt", link: "/inventory/item-masters", active: true },
      { text: "Vendors", icon: "fas fa-handshake", link: "/inventory/vendors", active: true },
      { text: "Goods Receipts (GR)", icon: "fas fa-truck-loading", link: "/inventory/goods-receipts", active: true }
    ]
  },
  {
    header: "Reports",
    icon: "fas fa-print",
    items: [
      { text: "Jasper Viewer", icon: "fas fa-file-alt", link: "/reports/viewer", active: true, after: "/reports/jasper-designer" },
      { text: "Jasper Event Logs", icon: "fas fa-history", link: "/reports/event-logs", active: true, after: "/reports/publish" }
    ]
  },
  {
    header: "Logs & Audit",
    icon: "fas fa-history",
    items: [
      { text: "Audit Logs", icon: "fas fa-shield-alt", link: "/logs/audit", active: true },
      { text: "Import Log", icon: "fas fa-file-import", link: "/logs/import", active: true }
    ]
  },
  {
    header: "Data Management",
    icon: "fas fa-database",
    items: [
      { text: "นับจำนวน Migration", icon: "fas fa-exchange-alt", link: "/migration/counts", active: true },
      { text: "Check Interface Setting", icon: "fas fa-cogs", link: "/interfaces/settings", active: true },
      { text: "Export Data", icon: "fas fa-file-export", link: "/exports", active: true }
    ]
  },
  {
    header: "Tools",
    icon: "fas fa-toolbox",
    items: [
      { text: "Shortcuts", icon: "fas fa-keyboard", link: "/tools/shortcuts", active: true }
    ]
  },
  {
    header: "Administration",
    icon: "fas fa-user-shield",
    items: [
      { text: "Users", icon: "fas fa-users-cog", link: "/admin/users", active: true, adminOnly: true },
      { text: "Roles & Permissions", icon: "fas fa-user-tag", link: "/admin/roles", active: true, adminOnly: true }
    ]
  }
];

global.menu = menu;
