const mariadb = require('mariadb');
const dbConnectionsModel = require('../../setting/models/dbconnections.model');

exports.getReportData = async function () {
    const connection = await dbConnectionsModel.getByIndex(global.sessionData.site_index);
    pool = await mariadb.createPool({
        host:  `${connection.JASPERSERVER_DB_IP}`,
        port:  `${connection.JASPERSERVER_DB_PORT}`,
        user: `${connection.JASPERSERVER_DB_USER}`,
        password: `${connection.JASPERSERVER_DB_PASS}`,
        database: `${connection.JASPERSERVER_DB_NAME}`,
        connectionLimit: 5
    });

    let conn;
    try {
        conn = await pool.getConnection();  // Get a connection from the pool
        const query = `
        SELECT 
            j.id as report_id,
            j.description as title,
            CONCAT(jf.uri, "/", j.name) AS report_path, 
            j.version, 
            je.event_date,  
            j2.username AS update_by, 
            j.creation_date, 
            j.update_date ,
            je.updating as updating
        FROM JIAccessEvent je 
LEFT JOIN JIResource j ON j.id = je.resource_id 
LEFT JOIN JIResourceFolder jf ON jf.id = j.parent_folder 
LEFT JOIN JIUser j2 ON j2.id = je.user_id 
WHERE  
    je.updating > 0
ORDER BY je.event_date DESC;
        `;
        const rows = await conn.query(query);
        return rows;  // Return the query results
    } catch (err) {
        console.error('Query Error:', err.message);
        throw err;  // Propagate error
    } finally {
        if (conn) conn.release();  // Release the connection back to the pool
    }
}