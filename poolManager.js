/**
 * @module poolManager
 */


function getPool(poolManager, dbname,options) {
    const { Pool } = require("better-sqlite-pool");
    if (!poolManager[dbname] || (poolManager[dbname] && !poolManager[dbname].acquire)) {
        poolManager[dbname] = new Pool(dbname, options);
        //console.log("Pool " + dbname + " created")
    } else {
        //console.log("Pool " + dbname + " already exists")
    }     
    return poolManager[dbname]
}

/**
 * Executes a callback on a pool obtained by name
 * @param {string} dbname - The filename of the sqlite database
 * @param {object} [options] - The options to pass to the better-sqlite-pool constructor
 * @param {function(Pool):void} callback - The callback to execute on the pool
 */
function execOnPoolbyName(poolManager,dbname, options, callback) {
    let pool = getPool(poolManager,dbname, options)
    execOnPool(pool, callback)
}

/**
 * Executes a callback on a pool.
 * @param {Pool} pool - The pool.
 * @param {function(DB):void} callback - The callback to execute on the pool.
 */
function execOnPool(pool, callback) {
    pool.acquire().then(db => {
        callback(db);
        db.release();
    });
}

module.exports = {
    getPool: getPool,
    execOnPoolbyName: execOnPoolbyName,
    execOnPool: execOnPool
}